"""Telnyx emulation: Messaging (SMS/MMS) and Programmable Fax.

Outbound (your app -> emulator): POST /v2/messages, GET /v2/messages/:id,
/v2/faxes (send, list, get, delete), messaging profiles and phone numbers.

Inbound (emulator -> your app), signed with Ed25519 like Telnyx:
  messaging: message.sent, message.finalized for outbound; message.received when
             an inbox texts one of your numbers.
  fax:       fax.queued -> fax.media.processed -> fax.sending.started ->
             fax.delivered | fax.failed for outbound; fax.received for inbound.
"""

from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from ..clock import iso, unix
from ..text import E164, START_WORDS, STOP_WORDS, sms_encoding
from .base import AdapterSpec, BuildAttempt
from .common import csv, install_request_log, make_pdf, pdf_page_count, stable_uuid, summarize_form

if TYPE_CHECKING:
    from ..emulator import Emulator
    from ..models import SendToApp

ID = "telnyx"
CARRIER = "phonybox"
ORG_ID = "6c0d4c8f-7a3b-4d6a-9b2f-1f2e3d4c5b6a"
CONNECTION_ID = "local-fax-app"

DEFAULTS: dict[str, str | bool] = {
    "appNumbers": "+16285550100, +16285550111, +16285550150",
    "messagingProfile": "40017f3a-5b8e-4c1d-9a7e-2f6b1c0d8e44",
    "acceptAnyKey": True,
    "apiKey": "KEY_local_01JC8M5QX2",
    "publicKey": "",  # filled from the signer at reset
    "messagingUrl": "http://localhost:3000/webhooks/telnyx/messaging",
    "messagingFailoverUrl": "",
    "faxUrl": "http://localhost:3000/webhooks/telnyx/fax",
    #: Fault rule: sends to these numbers fail (SMS: delivery_failed 40008; fax: user_busy).
    "failNumbers": "",
}

OPT_OUT_REPLY = "You have successfully been unsubscribed. You will not receive any more messages from this number. Reply START to resubscribe."


def settings(emu: Emulator) -> dict[str, Any]:
    return emu.store.adapter_state(ID)["values"]


def errors(status: int, code: str, title: str, detail: str, pointer: str | None = None) -> JSONResponse:
    err: dict[str, Any] = {"code": code, "title": title, "detail": detail, "meta": {"url": f"https://developers.telnyx.com/docs/overview/errors/{code}"}}
    if pointer:
        err["source"] = {"pointer": pointer}
    return JSONResponse({"errors": [err]}, status_code=status)


def _signed(emu: Emulator, payload: dict[str, Any], at: datetime) -> tuple[list[tuple[str, str]], bytes]:
    body = json.dumps(payload, separators=(",", ":")).encode()
    ts = str(unix(at))
    return [
        ("content-type", "application/json"),
        ("user-agent", "telnyx-webhooks/phonybox"),
        ("telnyx-timestamp", ts),
        ("telnyx-signature-ed25519", emu.signer.sign(ts, body)),
    ], body


def _event(emu: Emulator, event_type: str, event_id: str, payload: dict[str, Any], at: datetime, attempt: int, url: str) -> dict[str, Any]:
    return {
        "data": {"event_type": event_type, "id": event_id, "occurred_at": iso(at), "payload": payload, "record_type": "event"},
        "meta": {"attempt": attempt, "delivered_to": url},
    }


def enqueue_event(emu: Emulator, *, channel: str, event_type: str, related_id: str, payload: dict[str, Any], url: str, failover: str | None = None, delay: float = 0.0) -> None:
    event_id = emu.ids.uuid()
    emu.deliverer.enqueue(
        adapter_id=ID, channel=channel, event=event_type, url=url, related_id=related_id, failover_url=failover, delay=delay,
        build=lambda n, at: _signed(emu, _event(emu, event_type, event_id, payload, at, n, url), at),
    )


# -------------------------------------------------------------- messaging


def message_record(emu: Emulator, item: dict[str, Any], *, to_status: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    s = settings(emu)
    inbound = item["direction"] == "inbound"
    encoding, parts = sms_encoding(item["body"])
    sender = item["peerNumber"] if inbound else item["appNumber"]
    recipient = item["appNumber"] if inbound else item["peerNumber"]
    record = {
        "record_type": "message",
        "direction": item["direction"],
        "id": item["providerId"],
        "type": "MMS" if item["media"] else "SMS",
        "messaging_profile_id": s.get("messagingProfile"),
        "organization_id": ORG_ID,
        "from": {"phone_number": sender, "carrier": CARRIER, "line_type": "Wireless" if inbound else "Long Code"},
        "to": [{"phone_number": recipient, "carrier": CARRIER, "line_type": "Long Code" if inbound else "Wireless", "status": to_status}],
        "cc": [],
        "text": item["body"],
        "subject": None,
        "media": [
            {"url": f"{emu.cfg.base_url(emu.port(ID))}/media/{item['id']}/{i}", "content_type": m["contentType"], "size": m["size"], "hash_sha256": None}
            for i, m in enumerate(item["media"])
        ],
        "webhook_url": item.get("webhookUrl") or s.get("messagingUrl") or None,
        "webhook_failover_url": s.get("messagingFailoverUrl") or None,
        "encoding": encoding,
        "parts": parts,
        "tags": [],
        "cost": None,
        "received_at": item["createdAt"],
        "sent_at": None,
        "completed_at": None,
        "valid_until": None,
        "errors": [],
    }
    record.update(extra or {})
    return record


def _owned(emu: Emulator) -> list[str]:
    return csv(settings(emu).get("appNumbers"))


def send_sms(emu: Emulator, *, app_number: str, to: str, text: str, media_urls: list[str], webhook_url: str | None, webhook_failover_url: str | None) -> dict[str, Any]:
    """App -> number. Stored in the number's inbox, then message.sent and message.finalized."""
    at = emu.clock.now()
    inbox = emu.inbox_for("sms", to, ID)
    assert inbox is not None
    blocked = emu.store.opted_out(to, app_number)
    failing = to in csv(settings(emu).get("failNumbers"))
    item: dict[str, Any] = {
        "id": emu.ids.short("sm"),
        "channel": "sms",
        "inboxId": inbox["id"],
        "adapterId": ID,
        "direction": "outbound",
        "providerId": emu.ids.uuid(),
        "appNumber": app_number,
        "peerNumber": to,
        "body": text,
        "media": [{"filename": u.rsplit("/", 1)[-1] or "media", "contentType": "application/octet-stream", "size": 0} for u in media_urls],
        "parts": sms_encoding(text)[1],
        "status": "queued",
        "read": False,
        "createdAt": iso(at),
    }
    if blocked:
        item["note"] = "Not delivered: this number texted STOP to the sender. Telnyx error 40300."
    if webhook_url:
        item["webhookUrl"] = webhook_url
    emu.store.add_item(item)
    url = webhook_url or str(settings(emu).get("messagingUrl") or "")
    failover = webhook_failover_url or str(settings(emu).get("messagingFailoverUrl") or "") or None

    async def sent() -> None:
        now = iso(emu.clock.now())
        # `provider` keeps what GET /v2/messages/:id reports later; the control API ignores it.
        emu.store.update_item(item["id"], {"status": "sending", "provider": {"sent_at": now}})
        payload = message_record(emu, item, to_status="sent", extra={"sent_at": now})
        enqueue_event(emu, channel="sms", event_type="message.sent", related_id=item["id"], payload=payload, url=url, failover=failover)
        emu.scheduler.after(emu.cfg.event_delay, finalized)

    async def finalized() -> None:
        now = iso(emu.clock.now())
        ok = not (blocked or failing)
        errs = []
        if blocked:
            errs = [{"code": "40300", "title": "Blocked due to STOP message", "detail": "The recipient has opted out of messages from this number."}]
        elif failing:
            errs = [{"code": "40008", "title": "Undeliverable", "detail": "Fault rule failNumbers matched this recipient."}]
        sent_at = (emu.store.get_item(item["id"]) or {}).get("provider", {}).get("sent_at", now)
        outcome = {"sent_at": sent_at, "completed_at": now, "errors": errs}
        emu.store.update_item(item["id"], {"status": "delivered" if ok else "failed", "provider": outcome})
        payload = message_record(emu, item, to_status="delivered" if ok else "delivery_failed", extra=outcome)
        enqueue_event(emu, channel="sms", event_type="message.finalized", related_id=item["id"], payload=payload, url=url, failover=failover)

    emu.scheduler.after(emu.cfg.event_delay, sent)
    return item


def send_sms_to_app(emu: Emulator, inbox: dict[str, Any], *, app_number: str, body: str) -> dict[str, Any]:
    """Number -> app. Delivered as message.received. STOP/START update opt-out state."""
    at = emu.clock.now()
    item: dict[str, Any] = {
        "id": emu.ids.short("sm"),
        "channel": "sms",
        "inboxId": inbox["id"],
        "adapterId": ID,
        "direction": "inbound",
        "providerId": emu.ids.uuid(),
        "appNumber": app_number,
        "peerNumber": inbox["address"],
        "body": body,
        "media": [],
        "parts": sms_encoding(body)[1],
        "status": "received",
        "read": True,
        "createdAt": iso(at),
    }
    emu.store.add_item(item)
    s = settings(emu)
    payload = message_record(emu, item, to_status="webhook_delivered")
    enqueue_event(
        emu, channel="sms", event_type="message.received", related_id=item["id"], payload=payload,
        url=str(s.get("messagingUrl") or ""), failover=str(s.get("messagingFailoverUrl") or "") or None,
    )

    keyword = body.strip().lower()
    if keyword in STOP_WORDS:
        emu.store.set_opt_out(inbox["address"], app_number, True)
        emu.store.add_item({
            **item, "id": emu.ids.short("sm"), "direction": "outbound", "providerId": emu.ids.uuid(), "body": OPT_OUT_REPLY,
            "parts": sms_encoding(OPT_OUT_REPLY)[1], "status": "delivered", "read": False,
            "note": "Automatic opt-out reply. Sends from this number to this inbox now fail with 40300 until it texts START.",
        })
    elif keyword in START_WORDS:
        emu.store.set_opt_out(inbox["address"], app_number, False)
    return item


# -------------------------------------------------------------------- fax


def fax_record(emu: Emulator, item: dict[str, Any], status: str) -> dict[str, Any]:
    inbound = item["direction"] == "inbound"
    rec: dict[str, Any] = {
        "record_type": "fax",
        "id": item["providerId"],
        "connection_id": item.get("connectionId", CONNECTION_ID),
        "direction": item["direction"],
        "from": item["peerNumber"] if inbound else item["appNumber"],
        "to": item["appNumber"] if inbound else item["peerNumber"],
        "media_url": item.get("mediaUrl") or f"{emu.cfg.base_url(emu.port(ID))}/fax-media/{item['providerId']}.pdf",
        "quality": item["quality"],
        "status": status,
        "store_media": False,
        "webhook_url": item.get("webhookUrl") or settings(emu).get("faxUrl") or None,
        "created_at": item["createdAt"],
        "updated_at": iso(emu.clock.now()),
    }
    if item.get("clientState"):
        rec["client_state"] = item["clientState"]
    return rec


def _fax_payload(item: dict[str, Any], status: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    inbound = item["direction"] == "inbound"
    p: dict[str, Any] = {
        "connection_id": item.get("connectionId", CONNECTION_ID),
        "direction": item["direction"],
        "fax_id": item["providerId"],
        "from": item["peerNumber"] if inbound else item["appNumber"],
        "to": item["appNumber"] if inbound else item["peerNumber"],
        "status": status,
        "user_id": ORG_ID,
    }
    if item.get("clientState"):
        p["client_state"] = item["clientState"]
    p.update(extra or {})
    return p


def send_fax(emu: Emulator, *, connection_id: str, app_number: str, to: str, title: str, pages: int, quality: str,
             media_url: str | None, contents: bytes | None, webhook_url: str | None, client_state: str | None) -> dict[str, Any]:
    at = emu.clock.now()
    inbox = emu.inbox_for("fax", to, ID)
    assert inbox is not None
    item: dict[str, Any] = {
        "id": emu.ids.short("fx"),
        "channel": "fax",
        "inboxId": inbox["id"],
        "adapterId": ID,
        "direction": "outbound",
        "providerId": emu.ids.uuid(),
        "appNumber": app_number,
        "peerNumber": to,
        "title": title,
        "pages": pages,
        "quality": quality,
        "status": "queued",
        "events": [],
        "read": False,
        "createdAt": iso(at),
        "connectionId": connection_id,
    }
    if media_url:
        item["mediaUrl"] = media_url
    if webhook_url:
        item["webhookUrl"] = webhook_url
    if client_state:
        item["clientState"] = client_state
    emu.store.add_item(item, blobs=[(f"{title}.pdf", "application/pdf", contents)] if contents else None)
    url = webhook_url or str(settings(emu).get("faxUrl") or "")
    fails = to in csv(settings(emu).get("failNumbers"))
    steps = emu.cfg.fax_steps
    plan: list[tuple[str, str, dict[str, Any]]] = [
        ("fax.queued", "queued", {}),
        ("fax.media.processed", "queued", {"page_count": pages, "status": "media.processed"}),
        ("fax.sending.started", "sending", {"status": "sending"}),
        ("fax.failed", "failed", {"status": "failed", "failure_reason": "user_busy"})
        if fails
        else ("fax.delivered", "delivered", {"status": "delivered", "page_count": pages, "call_duration_secs": 8 + pages * 6}),
    ]
    events: list[dict[str, str]] = []

    def step(i: int) -> None:
        event, status, extra = plan[i]

        async def run() -> None:
            events.append({"event": event, "at": iso(emu.clock.now())})
            patch: dict[str, Any] = {"status": status, "events": list(events)}
            if event == "fax.failed":
                patch["failureReason"] = "user_busy"
            emu.store.update_item(item["id"], patch)
            enqueue_event(emu, channel="fax", event_type=event, related_id=item["id"], payload=_fax_payload(item, str(extra.get("status", event.removeprefix("fax."))), {k: v for k, v in extra.items() if k != "status"}), url=url)
            if i + 1 < len(plan):
                step(i + 1)

        emu.scheduler.after(steps[i] - (steps[i - 1] if i else 0), run)

    step(0)
    return item


def send_fax_to_app(emu: Emulator, inbox: dict[str, Any], *, app_number: str, title: str, pages: int) -> dict[str, Any]:
    at = emu.clock.now()
    item: dict[str, Any] = {
        "id": emu.ids.short("fx"),
        "channel": "fax",
        "inboxId": inbox["id"],
        "adapterId": ID,
        "direction": "inbound",
        "providerId": emu.ids.uuid(),
        "appNumber": app_number,
        "peerNumber": inbox["address"],
        "title": title,
        "pages": pages,
        "quality": "high",
        "status": "received",
        "events": [{"event": "fax.received", "at": iso(at)}],
        "read": True,
        "createdAt": iso(at),
    }
    emu.store.add_item(item, blobs=[(f"{title}.pdf", "application/pdf", make_pdf(title, pages))])
    media = f"{emu.cfg.base_url(emu.port(ID))}/fax-media/{item['providerId']}.pdf"
    enqueue_event(
        emu, channel="fax", event_type="fax.received", related_id=item["id"],
        payload=_fax_payload(item, "received", {"media_url": media, "page_count": pages, "call_duration_secs": 8 + pages * 6}),
        url=str(settings(emu).get("faxUrl") or ""),
    )
    return item


# -------------------------------------------------------------------- app


def build_app(emu: Emulator) -> FastAPI:
    app = FastAPI(title="Telnyx (phonybox)", docs_url=None, redoc_url=None, openapi_url=None)
    install_request_log(app, emu, ID, lambda: errors(503, "10006", "Service unavailable", "The Telnyx adapter is disabled in phonybox."))

    def auth_failed(request: Request) -> Response | None:
        header = request.headers.get("authorization", "")
        s = settings(emu)
        if not header.lower().startswith("bearer ") or (not s.get("acceptAnyKey") and header[7:].strip() != s.get("apiKey")):
            return errors(401, "10009", "Authentication failed", "Could not understand the provided credentials.")
        return None

    async def body_json(request: Request) -> dict[str, Any] | None:
        try:
            data = await request.json()
            return data if isinstance(data, dict) else None
        except ValueError:
            return None

    @app.post("/v2/messages")
    async def create_message(request: Request) -> Response:
        if r := auth_failed(request):
            return r
        data = await body_json(request)
        if data is None:
            return errors(400, "10015", "Bad Request", "The request body is not valid JSON.")
        sender, to = str(data.get("from") or ""), str(data.get("to") or "")
        text, media = str(data.get("text") or ""), [str(u) for u in data.get("media_urls") or []]
        if not to or not E164.match(to):
            return errors(422, "40310", "Invalid 'to' address", "The 'to' address should be in E.164 format.", "/to")
        if not sender:
            return errors(422, "40305", "Invalid 'from' address", "The 'from' address is required.", "/from")
        if sender not in _owned(emu):
            return errors(422, "40305", "Invalid 'from' address", "The 'from' address should be a number in your account.", "/from")
        if not text and not media:
            return errors(422, "40005", "Invalid message body", "Either 'text' or 'media_urls' is required.", "/text")
        item = send_sms(emu, app_number=sender, to=to, text=text, media_urls=media, webhook_url=data.get("webhook_url"), webhook_failover_url=data.get("webhook_failover_url"))
        request.state.related_id = item["id"]
        return JSONResponse({"data": message_record(emu, item, to_status="queued")})

    @app.get("/v2/messages/{message_id}")
    async def get_message(message_id: str, request: Request) -> Response:
        if r := auth_failed(request):
            return r
        item = emu.store.item_by_provider_id(message_id)
        if not item or item["channel"] != "sms":
            return errors(404, "10005", "Resource not found", "The requested resource or URL could not be found.")
        status = {"queued": "queued", "sending": "sent", "delivered": "delivered", "failed": "delivery_failed", "received": "webhook_delivered"}[item["status"]]
        return JSONResponse({"data": message_record(emu, item, to_status=status, extra=item.get("provider"))})

    @app.get("/v2/messaging_profiles")
    async def messaging_profiles(request: Request) -> Response:
        if r := auth_failed(request):
            return r
        s = settings(emu)
        profile = {
            "record_type": "messaging_profile", "id": s.get("messagingProfile"), "name": "phonybox", "enabled": True,
            "webhook_url": s.get("messagingUrl") or None, "webhook_failover_url": s.get("messagingFailoverUrl") or None,
            "webhook_api_version": "2", "whitelisted_destinations": ["US"], "created_at": iso(emu.started_at), "updated_at": iso(emu.started_at),
        }
        return JSONResponse({"data": [profile], "meta": {"page_number": 1, "page_size": 20, "total_pages": 1, "total_results": 1}})

    @app.get("/v2/phone_numbers")
    async def phone_numbers(request: Request) -> Response:
        if r := auth_failed(request):
            return r
        s = settings(emu)
        data = [
            {
                "record_type": "phone_number", "id": stable_uuid("number", n), "phone_number": n, "status": "active",
                "messaging_profile_id": s.get("messagingProfile"), "connection_id": CONNECTION_ID, "tags": [],
                "created_at": iso(emu.started_at), "updated_at": iso(emu.started_at),
            }
            for n in _owned(emu)
        ]
        return JSONResponse({"data": data, "meta": {"page_number": 1, "page_size": 20, "total_pages": 1, "total_results": len(data)}})

    @app.post("/v2/faxes")
    async def create_fax(request: Request) -> Response:
        if r := auth_failed(request):
            return r
        contents: bytes | None = None
        if "multipart" in request.headers.get("content-type", ""):
            request.state.log_body = await summarize_form(request)
            form = await request.form()
            data: dict[str, Any] = {k: v for k, v in form.items() if isinstance(v, str)}
            upload = form.get("contents")
            if upload is not None and not isinstance(upload, str):
                contents = await upload.read()
                data.setdefault("media_name", upload.filename or "upload.pdf")
        else:
            parsed = await body_json(request)
            if parsed is None:
                return errors(400, "10015", "Bad Request", "The request body is not valid JSON.")
            data = parsed
            if data.get("contents"):
                contents = base64.b64decode(str(data["contents"]))
        to, sender = str(data.get("to") or ""), str(data.get("from") or "")
        if not data.get("connection_id"):
            return errors(422, "10015", "Invalid parameter", "connection_id is required.", "/connection_id")
        if not E164.match(to):
            return errors(422, "10015", "Invalid parameter", "'to' must be an E.164 number.", "/to")
        if sender not in _owned(emu):
            return errors(422, "10015", "Invalid parameter", "'from' must be a number in your account.", "/from")
        media_url = data.get("media_url")
        if not (media_url or data.get("media_name") or contents):
            return errors(422, "10015", "Invalid parameter", "One of media_url, media_name or contents is required.", "/media_url")
        name = str(data.get("media_name") or (media_url or "fax.pdf").rsplit("/", 1)[-1])
        quality = str(data.get("quality") or "high")
        item = send_fax(
            emu, connection_id=str(data["connection_id"]), app_number=sender, to=to, title=name.rsplit(".", 1)[0],
            pages=pdf_page_count(contents) if contents else 1, quality=quality if quality in ("normal", "high", "very_high") else "high",
            media_url=str(media_url) if media_url else None, contents=contents, webhook_url=data.get("webhook_url"), client_state=data.get("client_state"),
        )
        request.state.related_id = item["id"]
        return JSONResponse({"data": fax_record(emu, item, "queued")}, status_code=202)

    @app.get("/v2/faxes")
    async def list_faxes(request: Request) -> Response:
        if r := auth_failed(request):
            return r
        q = request.query_params
        number = max(1, int(q.get("page[number]", 1)))
        size = max(1, min(int(q.get("page[size]", 20)), 250))
        page = emu.store.list_items({"channel": "fax"}, (number - 1) * size, size)
        data = [fax_record(emu, it, _fax_status(it)) for it in page["items"]]
        total = page["total"]
        return JSONResponse({"data": data, "meta": {"page_number": number, "page_size": size, "total_pages": max(1, -(-total // size)), "total_results": total}})

    @app.get("/v2/faxes/{fax_id}")
    async def get_fax(fax_id: str, request: Request) -> Response:
        if r := auth_failed(request):
            return r
        item = emu.store.item_by_provider_id(fax_id)
        if not item or item["channel"] != "fax":
            return errors(404, "10005", "Resource not found", "The requested resource or URL could not be found.")
        return JSONResponse({"data": fax_record(emu, item, _fax_status(item))})

    @app.delete("/v2/faxes/{fax_id}")
    async def delete_fax(fax_id: str, request: Request) -> Response:
        if r := auth_failed(request):
            return r
        item = emu.store.item_by_provider_id(fax_id)
        if not item or item["channel"] != "fax":
            return errors(404, "10005", "Resource not found", "The requested resource or URL could not be found.")
        emu.store.delete_item(item["id"])
        return Response(status_code=204)

    @app.get("/fax-media/{fax_id}.pdf")
    async def fax_media(fax_id: str) -> Response:
        item = emu.store.item_by_provider_id(fax_id)
        if not item:
            return errors(404, "10005", "Resource not found", "No media for this fax.")
        blob = emu.store.blob(item["id"], 0)
        data = blob[2] if blob else make_pdf(item["title"], item["pages"])
        return Response(data, media_type="application/pdf")

    @app.get("/media/{item_id}/{idx}")
    async def message_media(item_id: str, idx: int) -> Response:
        blob = emu.store.blob(item_id, idx)
        if not blob:
            return errors(404, "10005", "Resource not found", "No such media.")
        return Response(blob[2], media_type=blob[1])

    @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def not_emulated(path: str) -> Response:
        return errors(404, "10005", "Resource not found", f"/{path} is not emulated by phonybox.")

    return app


def _fax_status(item: dict[str, Any]) -> str:
    if item["status"] == "received":
        return "received"
    if item["events"]:
        last = item["events"][-1]["event"].removeprefix("fax.")
        return {"sending.started": "sending"}.get(last) or last
    return "queued"


# ------------------------------------------------------------------- spec


def _inbound(emu: Emulator, inbox: dict[str, Any], body: SendToApp) -> dict[str, Any]:
    owned = _owned(emu)
    if inbox["channel"] == "sms":
        if not body.body:
            raise HTTPException(422, "body is required")
        return send_sms_to_app(emu, inbox, app_number=body.app_number or owned[0], body=body.body)
    return send_fax_to_app(emu, inbox, app_number=body.app_number or owned[-1], title=body.title or "Fax", pages=max(1, min(body.pages or 1, 50)))


def _seed_event(emu: Emulator, item: dict[str, Any], heavy: dict[str, Any] | None, at0: datetime) -> tuple[str, str, BuildAttempt]:
    if item["channel"] == "sms":
        url = emu.cfg.webhook_url(str(DEFAULTS["messagingUrl"]))
        if item["direction"] == "outbound":
            event = "message.finalized"
            status = "delivered" if item["status"] == "delivered" else "delivery_failed"
            payload = message_record(emu, item, to_status=status, extra={"sent_at": item["createdAt"], "completed_at": item["createdAt"]})
        else:
            event = "message.received"
            payload = message_record(emu, item, to_status="webhook_delivered")
    else:
        url = emu.cfg.webhook_url(str(DEFAULTS["faxUrl"]))
        if item["direction"] == "inbound":
            event, status, extra = "fax.received", "received", {"page_count": item["pages"]}
        elif item["status"] == "failed":
            event, status, extra = "fax.failed", "failed", {"failure_reason": item.get("failureReason", "user_busy")}
        else:
            event, status, extra = "fax.delivered", "delivered", {"page_count": item["pages"], "call_duration_secs": 8 + item["pages"] * 6}
        payload = _fax_payload(item, status, extra)
    event_id = stable_uuid(item["id"], event)
    return event, url, lambda n, at: _signed(emu, _event(emu, event, event_id, payload, at, n, url), at)


def _seed_request(item: dict[str, Any], at: datetime) -> dict[str, Any] | None:
    if item["direction"] != "outbound":
        return None
    if item["channel"] == "sms":
        return {
            "method": "POST", "path": "/v2/messages", "status": 200,
            "requestBody": json.dumps({"from": item["appNumber"], "to": item["peerNumber"], "text": item["body"]}, indent=2),
            "responseBody": json.dumps({"data": {"record_type": "message", "id": item["providerId"], "to": [{"phone_number": item["peerNumber"], "status": "queued"}]}}, indent=2),
        }
    return {
        "method": "POST", "path": "/v2/faxes", "status": 202,
        "requestBody": json.dumps({"connection_id": CONNECTION_ID, "from": item["appNumber"], "to": item["peerNumber"], "media_url": f"http://localhost:3000/files/{item['id']}.pdf"}, indent=2),
        "responseBody": json.dumps({"data": {"record_type": "fax", "id": item["providerId"], "status": "queued"}}, indent=2),
    }


ADAPTER = AdapterSpec(
    id=ID,
    name="Telnyx",
    channels=("sms", "fax"),
    port_offset=2,
    base_path="/v2",
    defaults=lambda emu: {**DEFAULTS, "publicKey": emu.signer.public_key_b64},
    build_app=build_app,
    send_to_app=_inbound,
    seed_event=_seed_event,
    seed_request=_seed_request,
)
