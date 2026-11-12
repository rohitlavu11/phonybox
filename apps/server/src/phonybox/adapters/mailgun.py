"""Mailgun emulation.

Outbound (your app -> emulator): the Messages, Events, Domains, Bounces and
Routes endpoints your SDK calls. Sent mail lands in the recipient's inbox.

Inbound (emulator -> your app):
  - route.forward: mail sent from an inbox to an address matching a route is
    POSTed to the route's URL as multipart/form-data, like Mailgun's forward().
  - delivered / permanent_fail: event webhooks for outbound mail, JSON with the
    standard {"signature": ..., "event-data": ...} envelope.
Both are signed with the webhook signing key (HMAC-SHA256 of timestamp+token).
"""

from __future__ import annotations

import base64
import email
import email.policy
import fnmatch
import json
import re
from datetime import datetime
from email.utils import format_datetime
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from starlette.datastructures import UploadFile

from ..clock import iso, unix
from ..signing import mailgun_signature
from ..text import format_address, parse_addresses
from .base import AdapterSpec, BuildAttempt
from .common import csv, install_request_log, multipart, stable_hex, summarize_form

if TYPE_CHECKING:
    from ..emulator import Emulator
    from ..models import SendToApp

ID = "mailgun"

DEFAULTS: dict[str, str | bool] = {
    "domain": "mg.acme.test",
    "acceptAnyKey": True,
    "apiKey": "key-local-7c1e0a4b9d",
    "signingKey": "whsk-local-mg-3f9a21",
    "routeUrl": "http://localhost:3000/webhooks/mailgun/inbound",
    "routeMatch": 'match_recipient(".*@mg.acme.test")',
    "eventsUrl": "http://localhost:3000/webhooks/mailgun/events",
    #: Fault rule: recipients matching these globs bounce (permanent_fail, 550 5.1.1).
    "bounceAddresses": "bounce@*, *+bounce@*",
}

ACCEPTED = "Queued. Thank you."


def settings(emu: Emulator) -> dict[str, Any]:
    return emu.store.adapter_state(ID)["values"]


def _err(status: int, message: str) -> JSONResponse:
    return JSONResponse({"message": message}, status_code=status)


def _html_to_text(html: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?</\1>", "", html)
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>|</h\d>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _domain(address: str) -> str:
    return address.rsplit("@", 1)[-1]


# ------------------------------------------------------------------ capture


def capture(
    emu: Emulator,
    *,
    domain: str,
    sender: dict[str, str],
    recipients: list[dict[str, str]],
    subject: str,
    text: str,
    html: str | None,
    tags: list[str],
    extra_headers: list[tuple[str, str]],
    variables: dict[str, Any],
    attachments: list[tuple[str, str, bytes]],
) -> tuple[str, list[dict[str, Any]]]:
    """Store one message per recipient inbox and schedule its events. Returns (message-id, items)."""
    at = emu.clock.now()
    message_id = f"<{at:%Y%m%d%H%M%S}.{emu.ids.hex(16)}@{domain}>"
    bounce = csv(settings(emu).get("bounceAddresses"))
    to_header = ", ".join(format_address(r) for r in recipients)
    items: list[dict[str, Any]] = []
    seen_inboxes: set[str] = set()

    for r in recipients:
        inbox = emu.inbox_for("email", r["address"], ID)
        if inbox is None or inbox["id"] in seen_inboxes:
            continue
        seen_inboxes.add(inbox["id"])
        bounced = any(fnmatch.fnmatch(r["address"], pattern) for pattern in bounce)
        item: dict[str, Any] = {
            "id": emu.ids.short("em"),
            "channel": "email",
            "inboxId": inbox["id"],
            "adapterId": ID,
            "direction": "outbound",
            "messageId": message_id,
            "from": sender,
            "to": [r],
            "subject": subject,
            "text": text,
            "attachments": [{"filename": f, "contentType": c, "size": len(d)} for f, c, d in attachments],
            "headers": [],
            "tags": tags,
            "status": "bounced" if bounced else "delivered",
            "read": False,
            "createdAt": iso(at),
        }
        headers = [
            ("Received", f"from api (127.0.0.1) by phonybox mailgun; {format_datetime(at)}"),
            ("Message-Id", message_id),
            ("Date", format_datetime(at)),
            ("From", format_address(sender)),
            ("To", to_header),
            ("Subject", subject),
            ("Mime-Version", "1.0"),
            ("Content-Type", "multipart/alternative" if html else "text/plain; charset=utf-8"),
            ("X-Mailgun-Sending-Ip", "127.0.0.1"),
            *([("X-Mailgun-Tag", ", ".join(tags))] if tags else []),
            *([("X-Mailgun-Variables", json.dumps(variables))] if variables else []),
            *extra_headers,
        ]
        heavy = {"headers": headers, **({"html": html} if html else {})}
        emu.store.add_item(item, heavy, attachments)
        items.append(item)

        emu.store.add_mg_event(domain, "accepted", r["address"], at.timestamp(), _event_data(item, r, "accepted", at, variables))

        async def deliver(item: dict[str, Any] = item, r: dict[str, str] = r, bounced: bool = bounced) -> None:
            kind = "permanent_fail" if bounced else "delivered"
            now = emu.clock.now()
            data = _event_data(item, r, kind, now, variables)
            emu.store.add_mg_event(domain, data["event"], r["address"], now.timestamp(), data)
            emu.deliverer.enqueue(
                adapter_id=ID,
                channel="email",
                event=kind,
                url=str(settings(emu).get("eventsUrl") or ""),
                related_id=item["id"],
                build=lambda _n, at, data=data: event_request(emu, data, at),
            )

        emu.scheduler.after(emu.cfg.event_delay, deliver)

    return message_id, items


def _event_data(item: dict[str, Any], r: dict[str, str], kind: str, at: datetime, variables: dict[str, Any]) -> dict[str, Any]:
    event = {"delivered": "delivered", "accepted": "accepted"}.get(kind, "failed")
    data: dict[str, Any] = {
        "event": event,
        "id": stable_hex(item["id"], kind, length=22),
        "timestamp": round(at.timestamp(), 3),
        "log-level": "error" if event == "failed" else "info",
        "recipient": r["address"],
        "recipient-domain": _domain(r["address"]),
        "tags": item["tags"],
        "campaigns": [],
        "user-variables": variables,
        "flags": {"is-authenticated": True, "is-routed": False, "is-system-test": False, "is-test-mode": False},
        "envelope": {"sender": item["from"]["address"], "transport": "smtp", "targets": r["address"], "sending-ip": "127.0.0.1"},
        "message": {
            "headers": {
                "message-id": item["messageId"].strip("<>"),
                "from": format_address(item["from"]),
                "to": format_address(r),
                "subject": item["subject"],
            },
            "attachments": [{"filename": a["filename"], "content-type": a["contentType"], "size": a["size"]} for a in item["attachments"]],
            "size": len(item["text"]),
        },
    }
    if event == "delivered":
        data["delivery-status"] = {
            "tls": True, "mx-host": _domain(r["address"]), "code": 250, "description": "", "session-seconds": 0.05,
            "attempt-no": 1, "message": "OK", "certificate-verified": True,
        }
    elif event == "failed":
        data["severity"] = "permanent" if kind == "permanent_fail" else "temporary"
        data["reason"] = "bounce" if kind == "permanent_fail" else "generic"
        data["delivery-status"] = {
            "code": 550 if kind == "permanent_fail" else 421,
            "message": "5.1.1 The email account that you tried to reach does not exist" if kind == "permanent_fail" else "4.4.2 Connection dropped",
            "description": "Fault rule: bounceAddresses",
            "attempt-no": 1,
        }
    return data


def _signature(emu: Emulator, at: datetime) -> dict[str, str]:
    ts = str(unix(at))
    token = emu.ids.hex(50)
    return {"timestamp": ts, "token": token, "signature": mailgun_signature(str(settings(emu)["signingKey"]), ts, token)}


def event_request(emu: Emulator, event_data: dict[str, Any], at: datetime) -> tuple[list[tuple[str, str]], bytes]:
    body = json.dumps({"signature": _signature(emu, at), "event-data": event_data}, indent=2).encode()
    return [("content-type", "application/json"), ("user-agent", "mailgun/phonybox")], body


# ------------------------------------------------------------------ inbound


def _route_matches(expression: str, recipient: str) -> bool:
    expression = expression.strip()
    if expression == "catch_all()":
        return True
    m = re.fullmatch(r"""match_recipient\(\s*["'](.+)["']\s*\)""", expression)
    return bool(m and re.fullmatch(m.group(1), recipient, re.I))


def forward_targets(emu: Emulator, recipient: str) -> list[str]:
    s = settings(emu)
    urls: list[str] = []
    if s.get("routeUrl") and _route_matches(str(s.get("routeMatch") or "catch_all()"), recipient):
        urls.append(str(s["routeUrl"]))
    for route in emu.store.routes():
        if _route_matches(route["expression"], recipient):
            for action in route["actions"]:
                m = re.fullmatch(r"""forward\(\s*["'](.+)["']\s*\)""", action.strip())
                if m and m.group(1).startswith("http") and m.group(1) not in urls:
                    urls.append(m.group(1))
            if any(a.strip() == "stop()" for a in route["actions"]):
                break
    return urls


def forward_request(emu: Emulator, item: dict[str, Any], heavy: dict[str, Any], at: datetime) -> tuple[list[tuple[str, str]], bytes]:
    sig = _signature(emu, at)
    text = item["text"]
    stripped = re.split(r"\n\s*On .+wrote:\s*\n", text, maxsplit=1)[0].strip()
    fields = [
        ("recipient", item["to"][0]["address"]),
        ("sender", item["from"]["address"]),
        ("from", format_address(item["from"])),
        ("subject", item["subject"]),
        ("body-plain", text),
        ("stripped-text", stripped),
        ("stripped-signature", ""),
        *([("body-html", heavy["html"]), ("stripped-html", heavy["html"])] if heavy.get("html") else []),
        ("attachment-count", str(len(item["attachments"]))),
        ("message-headers", json.dumps(heavy.get("headers", []))),
        ("Message-Id", item["messageId"]),
        ("To", item["to"][0]["address"]),
        ("From", format_address(item["from"])),
        ("Subject", item["subject"]),
        ("Date", format_datetime(at)),
        ("timestamp", sig["timestamp"]),
        ("token", sig["token"]),
        ("signature", sig["signature"]),
    ]
    ctype, body = multipart(fields, f"phonybox-{stable_hex(item['id'], length=16)}")
    return [("content-type", ctype), ("user-agent", "mailgun/phonybox")], body


def send_to_app(emu: Emulator, inbox: dict[str, Any], *, to: str | None, subject: str, text: str, html: str | None) -> dict[str, Any]:
    """An inbox emails the app. Forwarded to every matching route."""
    at = emu.clock.now()
    domain = str(settings(emu)["domain"])
    to_addr = (to or f"support@{domain}").strip().lower()
    sender_addr = "someone@inbox.test" if inbox.get("catchAll") else inbox["address"]
    sender = {"name": inbox["label"], "address": sender_addr} if inbox.get("label") else {"address": sender_addr}
    iid = emu.ids.short("em")
    message_id = f"<{iid}@inbox.test>"
    item: dict[str, Any] = {
        "id": iid,
        "channel": "email",
        "inboxId": inbox["id"],
        "adapterId": ID,
        "direction": "inbound",
        "messageId": message_id,
        "from": sender,
        "to": [{"address": to_addr}],
        "subject": subject,
        "text": text or (_html_to_text(html) if html else ""),
        "attachments": [],
        "headers": [],
        "tags": [],
        "status": "delivered",
        "read": True,
        "createdAt": iso(at),
    }
    heavy: dict[str, Any] = {
        "headers": [
            ("Message-Id", message_id), ("Date", format_datetime(at)), ("From", format_address(sender)),
            ("To", to_addr), ("Subject", subject), ("X-Phonybox-Origin", "inbox"),
        ],
        **({"html": html} if html else {}),
    }
    emu.store.add_item(item, heavy)
    for url in forward_targets(emu, to_addr):
        emu.deliverer.enqueue(
            adapter_id=ID, channel="email", event="route.forward", url=url, related_id=iid,
            build=lambda _n, at: forward_request(emu, item, heavy, at),
        )
    return item


# --------------------------------------------------------------------- app


def build_app(emu: Emulator) -> FastAPI:
    app = FastAPI(title="Mailgun (phonybox)", docs_url=None, redoc_url=None, openapi_url=None)
    install_request_log(app, emu, ID, lambda: _err(503, "Mailgun adapter is disabled in phonybox"))

    def auth_failed(request: Request) -> Response | None:
        header = request.headers.get("authorization", "")
        if not header.lower().startswith("basic "):
            return PlainTextResponse("Forbidden", status_code=401)
        try:
            user, _, key = base64.b64decode(header[6:]).decode().partition(":")
        except ValueError:
            return PlainTextResponse("Forbidden", status_code=401)
        s = settings(emu)
        if user != "api" or (not s.get("acceptAnyKey") and key != s.get("apiKey")):
            return PlainTextResponse("Forbidden", status_code=401)
        return None

    def domain_missing(domain: str) -> Response | None:
        if domain.lower() != str(settings(emu)["domain"]).lower():
            return _err(404, f"Domain not found: {domain}")
        return None

    @app.post("/v3/{domain}/messages")
    async def send(domain: str, request: Request) -> Response:
        request.state.log_body = await summarize_form(request)
        if (r := auth_failed(request)) or (r := domain_missing(domain)):
            return r
        form = await request.form()
        sender = parse_addresses([str(form.get("from") or "")])
        if not form.get("from"):
            return _err(400, "from parameter is missing")
        if not sender:
            return _err(400, "from parameter is not a valid address. please check documentation")
        to = [str(v) for key in ("to", "cc", "bcc") for v in form.getlist(key) if str(v).strip()]
        if not any(str(v).strip() for v in form.getlist("to")):
            return _err(400, "to parameter is missing")
        recipients = parse_addresses(to)
        if not recipients:
            return _err(400, "to parameter is not a valid address. please check documentation")
        text = str(form.get("text") or "")
        html = str(form.get("html")) if form.get("html") else None
        if not (text or html or form.get("template")):
            return _err(400, "Need at least one of 'text', 'html' or 'template' parameters specified")

        attachments: list[tuple[str, str, bytes]] = []
        for key in ("attachment", "inline"):
            for f in form.getlist(key):
                if isinstance(f, UploadFile):
                    attachments.append((f.filename or "attachment", f.content_type or "application/octet-stream", await f.read()))
        variables: dict[str, Any] = {}
        for k, v in form.multi_items():
            if k.startswith("v:"):
                variables[k[2:]] = v
        if form.get("h:X-Mailgun-Variables"):
            try:
                variables.update(json.loads(str(form.get("h:X-Mailgun-Variables"))))
            except ValueError:
                pass
        headers = [(k[2:], str(v)) for k, v in form.multi_items() if k.startswith("h:") and k != "h:X-Mailgun-Variables"]

        message_id, items = capture(
            emu, domain=domain, sender=sender[0], recipients=recipients, subject=str(form.get("subject") or ""),
            text=text or (_html_to_text(html) if html else ""), html=html, tags=[str(t) for t in form.getlist("o:tag")],
            extra_headers=headers, variables=variables, attachments=attachments,
        )
        request.state.related_id = items[0]["id"] if items else None
        return JSONResponse({"id": message_id, "message": ACCEPTED})

    @app.post("/v3/{domain}/messages.mime")
    async def send_mime(domain: str, request: Request) -> Response:
        request.state.log_body = await summarize_form(request)
        if (r := auth_failed(request)) or (r := domain_missing(domain)):
            return r
        form = await request.form()
        upload = form.get("message")
        if not isinstance(upload, UploadFile):
            return _err(400, "message parameter is missing")
        if not form.getlist("to"):
            return _err(400, "to parameter is missing")
        msg = email.message_from_bytes(await upload.read(), policy=email.policy.default)
        body = msg.get_body(preferencelist=("plain",))
        html_part = msg.get_body(preferencelist=("html",))
        html = html_part.get_content() if html_part is not None else None
        text = body.get_content() if body is not None else (_html_to_text(html) if html else "")
        sender = parse_addresses([str(msg.get("From", ""))]) or [{"address": f"postmaster@{domain}"}]
        message_id, items = capture(
            emu, domain=domain, sender=sender[0], recipients=parse_addresses([str(v) for v in form.getlist("to")]),
            subject=str(msg.get("Subject", "")), text=text, html=html, tags=[str(t) for t in form.getlist("o:tag")],
            extra_headers=[], variables={}, attachments=[],
        )
        request.state.related_id = items[0]["id"] if items else None
        return JSONResponse({"id": message_id, "message": ACCEPTED})

    async def _events(domain: str, request: Request, page: str | None) -> Response:
        if (r := auth_failed(request)) or (r := domain_missing(domain)):
            return r
        q = request.query_params
        limit = max(1, min(int(q.get("limit", 100)), 300))
        token = page or q.get("page")
        offset = int(base64.urlsafe_b64decode(token).decode()) if token else 0
        items = emu.store.mg_events(
            domain, event=q.get("event"), recipient=q.get("recipient"), ascending=q.get("ascending") == "yes", limit=limit, offset=offset
        )
        base = f"{emu.cfg.base_url(emu.port(ID))}/v3/{domain}/events"

        def link(off: int) -> str:
            return f"{base}/{base64.urlsafe_b64encode(str(max(0, off)).encode()).decode()}"

        return JSONResponse({
            "items": items,
            "paging": {"first": link(0), "last": link(offset), "next": link(offset + len(items)), "previous": link(offset - limit)},
        })

    @app.get("/v3/{domain}/events")
    async def events(domain: str, request: Request) -> Response:
        return await _events(domain, request, None)

    @app.get("/v3/{domain}/events/{page}")
    async def events_page(domain: str, page: str, request: Request) -> Response:
        return await _events(domain, request, page)

    @app.get("/v3/domains/{domain}")
    async def get_domain(domain: str, request: Request) -> Response:
        if (r := auth_failed(request)) or (r := domain_missing(domain)):
            return r
        return JSONResponse({
            "domain": {
                "created_at": format_datetime(emu.started_at), "id": stable_hex(domain, length=24), "is_disabled": False,
                "name": domain, "require_tls": False, "skip_verification": False, "smtp_login": f"postmaster@{domain}",
                "spam_action": "disabled", "state": "active", "type": "custom", "web_prefix": "email", "web_scheme": "https",
                "wildcard": False,
            },
            "receiving_dns_records": [],
            "sending_dns_records": [],
        })

    @app.get("/v3/{domain}/bounces")
    async def bounces(domain: str, request: Request) -> Response:
        if (r := auth_failed(request)) or (r := domain_missing(domain)):
            return r
        rows = emu.store.mg_events(domain, event="failed", recipient=None, ascending=False, limit=1000, offset=0)
        seen: dict[str, dict[str, Any]] = {}
        for e in rows:
            if e.get("severity") == "permanent" and e["recipient"] not in seen:
                seen[e["recipient"]] = {
                    "address": e["recipient"], "code": str(e["delivery-status"]["code"]), "error": e["delivery-status"]["message"],
                    "created_at": format_datetime(datetime.fromtimestamp(e["timestamp"]).astimezone()),
                }
        base = f"{emu.cfg.base_url(emu.port(ID))}/v3/{domain}/bounces"
        return JSONResponse({"items": list(seen.values()), "paging": {"first": base, "last": base, "next": base, "previous": base}})

    @app.post("/v3/routes")
    async def create_route(request: Request) -> Response:
        request.state.log_body = await summarize_form(request)
        if r := auth_failed(request):
            return r
        form = await request.form()
        if not form.get("expression") or not form.getlist("action"):
            return _err(400, "expression and action are required")
        route = {
            "id": emu.ids.hex(24),
            "priority": int(form.get("priority") or 0),
            "expression": str(form.get("expression")),
            "actions": [str(a) for a in form.getlist("action")],
            "description": str(form.get("description") or ""),
            "created_at": format_datetime(emu.clock.now()),
        }
        emu.store.add_route(route)
        return JSONResponse({"message": "Route has been created", "route": route})

    @app.get("/v3/routes")
    async def list_routes(request: Request) -> Response:
        if r := auth_failed(request):
            return r
        items = emu.store.routes()
        return JSONResponse({"total_count": len(items), "items": items})

    @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def not_emulated(path: str) -> Response:
        return _err(404, f"Not found: /{path} is not emulated by phonybox")

    return app


# ------------------------------------------------------------------- spec


def _inbound(emu: Emulator, inbox: dict[str, Any], body: SendToApp) -> dict[str, Any]:
    if not (body.text or body.html):
        raise HTTPException(422, "text or html is required")
    return send_to_app(emu, inbox, to=body.to, subject=body.subject or "", text=body.text or "", html=body.html)


def _seed_event(emu: Emulator, item: dict[str, Any], heavy: dict[str, Any] | None, at0: datetime) -> tuple[str, str, BuildAttempt]:
    if item["direction"] == "outbound":
        kind = "permanent_fail" if item["status"] == "bounced" else "delivered"
        data = _event_data(item, item["to"][0], kind, at0, {})
        return kind, emu.cfg.webhook_url(str(DEFAULTS["eventsUrl"])), lambda _n, at: event_request(emu, data, at)
    fields = heavy or {}
    return "route.forward", emu.cfg.webhook_url(str(DEFAULTS["routeUrl"])), lambda _n, at: forward_request(emu, item, fields, at)


def _seed_request(item: dict[str, Any], at: datetime) -> dict[str, Any] | None:
    if item["direction"] != "outbound":
        return None
    body = "\n".join([f"from={format_address(item['from'])}", f"to={item['to'][0]['address']}", f"subject={item['subject']}", "text=…", *[f"o:tag={t}" for t in item["tags"]]])
    return {
        "method": "POST", "path": f"/v3/{DEFAULTS['domain']}/messages", "status": 200, "requestBody": body,
        "responseBody": json.dumps({"id": item["messageId"], "message": ACCEPTED}, indent=2),
    }


ADAPTER = AdapterSpec(
    id=ID,
    name="Mailgun",
    channels=("email",),
    port_offset=1,
    sdk_setup=(
        "mailgun.js: new Mailgun(formData).client({ username: 'api', key, url: '{url}' }). "
        "Python mailgun: Client(auth=('api', key), api_url='{url}'). "
        "Plain HTTP: POST {url}/v3/<domain>/messages with basic auth api:<any key>. "
        "Verify webhooks with the signingKey setting (HMAC-SHA256 of timestamp + token)."
    ),
    defaults=lambda emu: dict(DEFAULTS),
    build_app=build_app,
    send_to_app=_inbound,
    seed_event=_seed_event,
    seed_request=_seed_request,
)
