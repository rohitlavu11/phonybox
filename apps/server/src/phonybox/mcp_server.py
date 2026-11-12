"""MCP server: Phonybox inboxes as tools for AI agents.

Claude Code, Claude Desktop, Cursor and other MCP clients use these tools to test an
app end to end: create an inbox, use its address in the product, wait for the email
or text the app sends, act on its code or link, reply as the person, and check that
the app handled the provider's webhook.

Two transports, same tools:

  http   served by every Phonybox at http://localhost:4100/mcp
           claude mcp add --transport http phonybox http://localhost:4100/mcp
  stdio  `phonybox mcp`, for clients that launch a command; talks to a running
         Phonybox at --url / PHONYBOX_URL

The tools are thin wrappers over the control API (/api), so they behave exactly like
the inspector and the REST endpoints in docs/reference/control-api.md.
"""

from __future__ import annotations

import asyncio
import html as htmllib
import re
from collections.abc import Callable
from typing import TYPE_CHECKING, Annotated, Any, Literal
from urllib.parse import quote, urlsplit

import httpx
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import Field
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.types import ASGIApp, Receive, Scope, Send

from . import __version__
from . import adapters as registry
from .text import extract

if TYPE_CHECKING:
    from fastapi import FastAPI

    from .emulator import Emulator

INSTRUCTIONS = """\
Phonybox runs fake email, SMS and fax providers (Mailgun, Telnyx) locally. The app under test
sends through Phonybox with its normal SDK, and every message lands in an inbox you can read.
Messages you send from an inbox reach the app as the provider's real, signed webhooks.

A typical test:
1. get_setup once, to check the app's provider base URLs point at Phonybox and its webhook
   URLs point at the app.
2. create_inbox for this run, with a tag such as run:<name>, and use its address or number in
   the product (sign-up form, phone field, fax number).
3. Drive the product, then wait_for_message on that inbox. Use the returned codes and links.
4. To act as the person, send_email_to_app or send_sms_to_app. The result shows how the app's
   webhook handler responded; list_webhook_deliveries shows every attempt.
5. delete_inboxes with the run tag when you're done.

If a message never arrives, the wait_for_message error and list_api_requests show whether the
app called Phonybox at all and what it got back.
"""

READ = ToolAnnotations(read_only_hint=True, open_world_hint=False)
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=False)
DESTRUCTIVE = ToolAnnotations(read_only_hint=False, destructive_hint=True, open_world_hint=False)

#: The control API says outbound/inbound from the provider's point of view; agents think in terms of the app.
TO_API = {"from_app": "outbound", "to_app": "inbound"}
FROM_API = {v: k for k, v in TO_API.items()}

Direction = Literal["from_app", "to_app"]
InboxKey = Annotated[str, Field(description="The inbox's email address or E.164 phone number (or its id).")]
DeliveryWait = Annotated[
    float,
    Field(ge=0, le=30, description="Seconds to wait for the app's webhook response before returning. 0 returns at once."),
]


class Api:
    """The control API, in-process (the /mcp endpoint) or over HTTP (`phonybox mcp`)."""

    def __init__(self, http: httpx.AsyncClient, public_url: Callable[[int], str], where: str) -> None:
        self.http = http
        #: port -> base URL that people and the app under test use for that port
        self.public_url = public_url
        self.where = where

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        none_on: tuple[int, ...] = (),
        timeout: float = 15,
    ) -> Any:
        try:
            r = await self.http.request(
                method, path, params={k: v for k, v in (params or {}).items() if v is not None}, json=json, timeout=timeout
            )
        except httpx.TransportError as e:
            raise ToolError(
                f"Can't reach Phonybox at {self.where} ({type(e).__name__}). Is it running? "
                "Start it with `docker run --rm -p 4100-4102:4100-4102 ghcr.io/rohitlavu11/phonybox`, "
                "or point `phonybox mcp` at it with --url."
            ) from e
        if r.status_code in none_on:
            return None
        if r.status_code >= 400:
            raise ToolError(_detail(r))
        return r.json() if r.content else None


def _detail(r: httpx.Response) -> str:
    try:
        detail = r.json().get("detail")
    except ValueError:
        return f"Phonybox returned {r.status_code}: {r.text[:300]}"
    if isinstance(detail, list):  # FastAPI validation errors
        return "; ".join(f"{'.'.join(str(p) for p in e.get('loc', [])[1:])}: {e.get('msg')}" for e in detail)
    return str(detail or f"Phonybox returned {r.status_code}")


def _path(value: str) -> str:
    return quote(value.strip(), safe="")


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else f"{text[:limit]}… [{len(text) - limit} more characters]"


# ------------------------------------------------------------------ formatting

_ANCHOR = re.compile(r"""(?is)<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>(.*?)</a\s*>""")
_URL = re.compile(r"https?://[^\s\"'<>()]+")


def _html_text(html: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?</\1>", "", html)
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>|</h\d>|</li>", "\n", text)
    text = htmllib.unescape(re.sub(r"<[^>]+>", "", text))
    return re.sub(r"\n\s*\n+", "\n\n", re.sub(r"[ \t]+", " ", text)).strip()


def links(text: str, html: str = "") -> list[dict[str, str]]:
    """Every http(s) link, in document order, with its anchor text when the HTML has one.

    Agents need the right link ("Confirm email", not "Unsubscribe"), and HTML-only emails
    keep their links in href attributes, which a plain-text scan misses."""
    found: dict[str, str] = {}
    for _, href, label in _ANCHOR.findall(html or ""):
        url = htmllib.unescape(href).strip()
        if url.startswith(("http://", "https://")) and url not in found:
            found[url] = " ".join(htmllib.unescape(re.sub(r"<[^>]+>", " ", label)).split())[:80]
    for url in _URL.findall(text or ""):
        found.setdefault(url.rstrip(".,;:!?"), "")
    return [{"url": u, "text": t} if t else {"url": u} for u, t in list(found.items())[:25]]


def _address(a: dict[str, str]) -> str:
    return f"{a['name']} <{a['address']}>" if a.get("name") else a["address"]


def message(item: dict[str, Any], *, full: bool) -> dict[str, Any]:
    """A message as an agent wants it: who, what, and the codes and links to act on."""
    channel = item["channel"]
    inbound = item["direction"] == "inbound"
    out: dict[str, Any] = {
        "id": item["id"],
        "channel": channel,
        "direction": FROM_API.get(item["direction"], item["direction"]),
        "at": item["createdAt"],
        "status": item["status"],
    }
    body, html = "", ""
    if channel == "email":
        html = item.get("html") or ""
        body = item.get("text") or _html_text(html)
        out["from"] = _address(item["from"])
        out["to"] = [_address(a) for a in item["to"]]
        if item.get("cc"):
            out["cc"] = [_address(a) for a in item["cc"]]
        out["subject"] = item["subject"]
        if item.get("attachments"):
            out["attachments"] = [f"{a['filename']} ({a['contentType']}, {a['size']} bytes)" for a in item["attachments"]]
    else:
        out["from"] = item["peerNumber"] if inbound else item["appNumber"]
        out["to"] = item["appNumber"] if inbound else item["peerNumber"]
        if channel == "sms":
            body = item.get("body") or ""
            if item.get("media"):
                out["media"] = [m["filename"] for m in item["media"]]
        else:
            out["title"] = item["title"]
            out["pages"] = item["pages"]
            if item.get("failureReason"):
                out["failure_reason"] = item["failureReason"]
    if item.get("note"):
        out["note"] = item["note"]
    if body:
        out["text"] = _clip(body, 8000 if full else 280)
    codes = extract(body)["codes"]
    if codes:
        out["codes"] = codes
    found = links(body, html)
    if found:
        out["links"] = found if full else [link["url"] for link in found[:5]]
    return out


def delivery(w: dict[str, Any]) -> dict[str, Any]:
    status = w.get("status")
    out: dict[str, Any] = {
        "id": w["id"],
        "event": w["event"],
        "url": w["url"],
        "attempt": f"{w['attempt']} of {w['maxAttempts']}",
        "at": w["createdAt"],
        "ok": status is not None and 200 <= status < 300,
        "status": status,
    }
    if w.get("error"):
        out["error"] = w["error"]
    if w.get("responseBody"):
        out["response"] = _clip(w["responseBody"], 1500)
    if w.get("relatedId"):
        out["message_id"] = w["relatedId"]
    return out


def inbox_summary(i: dict[str, Any]) -> dict[str, Any]:
    out = {"address": i["address"], "inbox_id": i["id"], "channel": i["channel"], "tags": i["tags"]}
    if i.get("label"):
        out["label"] = i["label"]
    out |= {"messages": i["messageCount"], "unread": i["unreadCount"], "last_activity": i["lastActivityAt"]}
    if i.get("failing"):
        out["failing_webhooks"] = i["failing"]
    return out


# ------------------------------------------------------------------ the server


def build_server(api: Api) -> MCPServer:
    server = MCPServer(
        name="phonybox",
        title="Phonybox",
        description="Local email, SMS and fax inboxes for testing apps and AI agents.",
        instructions=INSTRUCTIONS,
        website_url="https://rohitlavu11.github.io/phonybox/guide/mcp",
        version=__version__,
        log_level="WARNING",
    )
    loop_time = lambda: asyncio.get_running_loop().time()  # noqa: E731

    async def find_inbox(key: str) -> dict[str, Any] | None:
        return await api.request("GET", f"/api/inboxes/{_path(key)}", none_on=(404,))

    async def ensure_inbox(key: str, channel: str) -> dict[str, Any]:
        """The inbox to send from, created if this address hasn't been used yet."""
        found = await find_inbox(key)
        if found:
            if found["channel"] != channel:
                raise ToolError(f"{key} is a {found['channel']} inbox, not {channel}.")
            return found
        return await api.request("POST", "/api/inboxes", json={"channel": channel, "address": key})

    async def first_delivery(item_id: str, seconds: float) -> dict[str, Any] | None:
        deadline = loop_time() + seconds
        while True:
            attempts = await api.request("GET", f"/api/items/{_path(item_id)}/webhooks")
            if attempts:
                latest = max(attempts, key=lambda w: (w["createdAt"], w["attempt"]))
                return await api.request("GET", f"/api/webhooks/{_path(latest['id'])}")
            if loop_time() >= deadline:
                return None
            await asyncio.sleep(0.2)

    async def sent(item: dict[str, Any], wait: float) -> dict[str, Any]:
        out: dict[str, Any] = {"message": message(item, full=False)}
        w = await first_delivery(item["id"], wait) if wait > 0 else None
        if w:
            out["webhook"] = delivery(w)
            if not out["webhook"]["ok"]:
                out["hint"] = (
                    "The app's webhook handler didn't accept it. Phonybox retries automatically; after fixing the "
                    "handler, replay_webhook re-sends this exact request. get_webhook_delivery shows the full request."
                )
        else:
            out["webhook"] = None
            out["hint"] = (
                f"No webhook attempt within {wait:g}s. It may still be on its way (list_webhook_deliveries), or the "
                "provider has no webhook URL set for this (get_setup)."
            )
        return out

    async def not_arrived(key: str, inbox: dict[str, Any] | None, timeout: float, direction: Direction, contains: str | None) -> str:
        who = "from the app " if direction == "from_app" else ""
        lines = [f"Nothing {who}arrived in {key} within {timeout:g}s" + (f" matching {contains!r}." if contains else ".")]
        if inbox is None:
            lines.append("No inbox exists for that address yet, so the app hasn't sent anything to it.")
        elif inbox["messageCount"]:
            lines.append(f"The inbox has {inbox['messageCount']} message(s); list_messages shows them.")
        recent = (await api.request("GET", "/api/requests", params={"limit": 5}))["items"]
        if not recent:
            lines.append(
                "Phonybox hasn't received any API calls from the app. Check that the app's provider SDK points at "
                "Phonybox (get_setup shows the base URLs), and that the step that sends the message ran."
            )
        else:
            lines.append("Latest provider API calls the app made:")
            for r in recent:
                lines.append(f"  {r['createdAt']}  {r['method']} {r['path']} -> {r['status']}")
        return "\n".join(lines)

    # ------------------------------------------------------------- setup

    @server.tool(annotations=READ)
    async def get_setup() -> dict[str, Any]:
        """How the app under test connects to Phonybox: each provider's API base URL, how to point its SDK there,
        and its settings (credentials, webhook URLs that Phonybox calls on the app, sending domain, phone numbers).
        Call this first if you're not sure the app is configured for Phonybox."""
        health = await api.request("GET", "/api/health")
        states = await api.request("GET", "/api/adapters")
        providers = []
        for spec in registry.REGISTRY.values():
            if spec.id not in states:
                continue
            port = health["ports"].get(spec.id)
            url = f"{api.public_url(port)}{spec.base_path}" if port else None
            providers.append({
                "id": spec.id,
                "name": spec.name,
                "channels": list(spec.channels),
                "enabled": states[spec.id]["enabled"],
                "api_base_url": url,
                "sdk_setup": spec.sdk_setup.replace("{url}", url or ""),
                "settings": states[spec.id]["values"],
            })
        control = api.public_url(health["ports"]["control"])
        return {
            "version": health["version"],
            "inspector": control,
            "control_api": f"{control}/api",
            "providers": providers,
            "notes": [
                "Settings ending in Url are where Phonybox POSTs webhooks to the app. Change them with configure_provider.",
                "While acceptAnyKey is true, any API key works.",
                "Mail or texts to an address without an inbox create one automatically.",
            ],
        }

    @server.tool(annotations=WRITE)
    async def configure_provider(
        provider: Annotated[str, Field(description="Provider id from get_setup, e.g. mailgun or telnyx.")],
        settings: Annotated[
            dict[str, str | bool] | None,
            Field(
                description="Settings to change, by the keys get_setup shows. Examples: Mailgun routeUrl, eventsUrl, "
                "domain; Telnyx messagingUrl, faxUrl, appNumbers, failNumbers (comma-separated numbers whose "
                "messages fail delivery, to test error handling)."
            ),
        ] = None,
        enabled: Annotated[bool | None, Field(description="Turn the provider on or off.")] = None,
    ) -> dict[str, Any]:
        """Change a provider's settings, for example to point its webhooks at the port the app runs on, or to
        make deliveries to some numbers fail. Applies immediately."""
        states = await api.request("GET", "/api/adapters")
        if provider not in states:
            raise ToolError(f"No provider {provider!r}. Providers: {', '.join(states)}.")
        unknown = sorted(set(settings or {}) - set(states[provider]["values"]))
        if unknown:
            raise ToolError(f"Unknown setting(s) {', '.join(unknown)}. {provider} has: {', '.join(states[provider]['values'])}.")
        state = await api.request("PATCH", f"/api/adapters/{_path(provider)}", json={"enabled": enabled, "values": settings or {}})
        return {"provider": provider, "enabled": state["enabled"], "settings": state["values"]}

    # ----------------------------------------------------------- inboxes

    @server.tool(annotations=WRITE)
    async def create_inbox(
        channel: Annotated[Literal["email", "sms", "fax"], Field(description="email gives an email address; sms and fax give a phone number.")],
        tags: Annotated[
            list[str] | None,
            Field(description="Labels for this test run, e.g. ['run:signup-1']. delete_inboxes removes every inbox with a tag."),
        ] = None,
        label: Annotated[str | None, Field(description="A name to show in the inspector.")] = None,
        address: Annotated[
            str | None,
            Field(description="A specific email address or E.164 number. Omit for a fresh one (agent-xxxx@inbox.test, or a 555-01xx number)."),
        ] = None,
    ) -> dict[str, Any]:
        """Create an inbox: a fresh email address or phone number for the app under test to send to.
        Use a new one per test run so runs never see each other's messages."""
        made = await api.request(
            "POST", "/api/inboxes", json={"channel": channel, "tags": tags or [], "label": label, "address": address}
        )
        return inbox_summary(made) | {"next": "Use this address in the product, then call wait_for_message with it."}

    @server.tool(annotations=READ)
    async def list_inboxes(
        channel: Annotated[Literal["email", "sms", "fax"] | None, Field(description="Only this channel.")] = None,
        search: Annotated[
            str | None, Field(description="Part of an address or label. 'tag:run:1' matches inboxes whose tags start with run:1.")
        ] = None,
        limit: Annotated[int, Field(ge=1, le=100)] = 20,
    ) -> dict[str, Any]:
        """List inboxes, most recently active first. Inboxes appear automatically when the app sends to a new address."""
        page = await api.request("GET", "/api/inboxes", params={"channel": channel, "q": search, "limit": limit})
        return {"total": page["total"], "inboxes": [inbox_summary(i) for i in page["items"]]}

    @server.tool(annotations=DESTRUCTIVE)
    async def delete_inboxes(
        tag: Annotated[str | None, Field(description="Delete every inbox with exactly this tag, e.g. run:signup-1.")] = None,
        inbox: Annotated[str | None, Field(description="Or delete one inbox, by address or id.")] = None,
    ) -> dict[str, Any]:
        """Delete inboxes and everything in them: all inboxes with a tag (cleanup after a test run), or one inbox."""
        if bool(tag) == bool(inbox):
            raise ToolError("Pass either tag or inbox.")
        if inbox:
            found = await find_inbox(inbox)
            if not found:
                return {"deleted": 0}
            ids = [found["id"]]
        else:
            ids, cursor = [], 0
            while cursor is not None:
                page = await api.request("GET", "/api/inboxes", params={"q": f"tag:{tag}", "limit": 500, "cursor": cursor})
                ids += [i["id"] for i in page["items"] if tag in i["tags"]]  # exact: the search matches prefixes
                cursor = page["nextCursor"]
        if not ids:
            return {"deleted": 0}
        done = await api.request("POST", "/api/inboxes/bulk", json={"op": "delete", "ids": ids})
        return {"deleted": done["affected"]}

    # ---------------------------------------------------------- messages

    @server.tool(annotations=READ)
    async def wait_for_message(
        inbox: Annotated[
            str,
            Field(description="Email address or E.164 number (or inbox id). It doesn't have to exist yet: it appears when the first message arrives."),
        ],
        timeout_seconds: Annotated[float, Field(ge=0, le=120)] = 30,
        contains: Annotated[
            str | None, Field(description="Only messages whose subject (email), text (SMS) or title (fax) contains this, ignoring case.")
        ] = None,
        after_message_id: Annotated[
            str | None,
            Field(description="Only messages newer than this one. Pass the id of the last message you've seen to wait for the next one."),
        ] = None,
        direction: Annotated[
            Direction, Field(description="from_app (default): messages the app sent. to_app: messages sent from the inbox to the app.")
        ] = "from_app",
    ) -> dict[str, Any]:
        """Wait for a message in an inbox and return it, with its one-time codes and links (with their link text)
        already extracted. Returns at once if a matching message is already there; otherwise waits up to
        timeout_seconds. If nothing arrives, the error explains what Phonybox did or didn't receive from the app."""
        deadline = loop_time() + timeout_seconds
        found = await find_inbox(inbox)
        while found is None and loop_time() < deadline:
            await asyncio.sleep(0.25)
            found = await find_inbox(inbox)
        if found is None:
            raise ToolError(await not_arrived(inbox, None, timeout_seconds, direction, contains))
        since = None
        if after_message_id:
            since = (await api.request("GET", f"/api/items/{_path(after_message_id)}"))["createdAt"]
        remaining = max(0.0, deadline - loop_time())
        got = await api.request(
            "GET",
            f"/api/inboxes/{_path(found['id'])}/wait",
            params={"timeout": round(remaining, 2), "subject": contains, "direction": TO_API[direction], "since": since},
            none_on=(408,),
            timeout=remaining + 15,
        )
        if got is None:
            raise ToolError(await not_arrived(inbox, await find_inbox(found["id"]), timeout_seconds, direction, contains))
        return message(got["item"], full=True)

    @server.tool(annotations=READ)
    async def list_messages(
        inbox: InboxKey,
        direction: Annotated[Direction | None, Field(description="from_app or to_app; omit for both.")] = None,
        limit: Annotated[int, Field(ge=1, le=50)] = 10,
    ) -> dict[str, Any]:
        """List an inbox's messages, newest first, with short previews. read_message gives the full content."""
        found = await find_inbox(inbox)
        if not found:
            raise ToolError(f"No inbox for {inbox} yet. The app hasn't sent anything to it, and none was created.")
        page = await api.request(
            "GET", f"/api/inboxes/{_path(found['id'])}/messages", params={"direction": TO_API.get(direction or ""), "limit": limit}
        )
        return {"inbox": found["address"], "total": page["total"], "messages": [message(i, full=False) for i in page["items"]]}

    @server.tool(annotations=READ)
    async def read_message(message_id: Annotated[str, Field(description="A message id from wait_for_message or list_messages.")]) -> dict[str, Any]:
        """The full message: text, every link with its link text, codes, attachments, delivery status."""
        return message(await api.request("GET", f"/api/items/{_path(message_id)}"), full=True)

    # ------------------------------------------------- acting as the person

    @server.tool(annotations=WRITE)
    async def send_email_to_app(
        inbox: Annotated[str, Field(description="The email address to send from (created if new).")],
        text: Annotated[str, Field(description="Plain-text body.")],
        subject: Annotated[str | None, Field(description="Required unless reply_to_message_id is given.")] = None,
        reply_to_message_id: Annotated[
            str | None, Field(description="Reply to this message: sends to its sender, with subject 'Re: …' unless you pass one.")
        ] = None,
        to: Annotated[str | None, Field(description="App address to send to. Default: the reply's sender, else support@<sending domain>.")] = None,
        html: Annotated[str | None, Field(description="Optional HTML body.")] = None,
        wait_for_delivery_seconds: DeliveryWait = 5,
    ) -> dict[str, Any]:
        """Send an email from an inbox to the app, as the person who owns that address. The app receives it the way
        the provider delivers inbound mail (Mailgun: a signed route forward to the app's webhook URL). Returns the
        message and how the app's webhook handler responded."""
        if reply_to_message_id:
            original = await api.request("GET", f"/api/items/{_path(reply_to_message_id)}")
            reply_to = next((v for k, v in original.get("headers") or [] if k.lower() == "reply-to"), None)
            to = to or reply_to or original["from"]["address"]
            if not subject:
                subject = original["subject"] if original["subject"].lower().startswith("re:") else f"Re: {original['subject']}"
        if not subject:
            raise ToolError("subject is required unless reply_to_message_id is given.")
        found = await ensure_inbox(inbox, "email")
        item = await api.request(
            "POST", f"/api/inboxes/{_path(found['id'])}/send", json={"to": to, "subject": subject, "text": text, "html": html}
        )
        return await sent(item, wait_for_delivery_seconds)

    @server.tool(annotations=WRITE)
    async def send_sms_to_app(
        inbox: Annotated[str, Field(description="The phone number to text from, E.164 (created if new).")],
        text: Annotated[str, Field(description="Message text. STOP and START change opt-out state, like a real carrier.")],
        app_number: Annotated[
            str | None, Field(description="The app's number to text. Default: the number that last texted this inbox, else the app's first number.")
        ] = None,
        wait_for_delivery_seconds: DeliveryWait = 5,
    ) -> dict[str, Any]:
        """Text the app from an inbox's number, as the person who owns it. The app receives the provider's inbound
        webhook (Telnyx: a signed message.received). Returns the message and how the app's webhook handler responded."""
        found = await ensure_inbox(inbox, "sms")
        if not app_number:
            last = await api.request("GET", f"/api/inboxes/{_path(found['id'])}/messages", params={"direction": "outbound", "limit": 1})
            app_number = last["items"][0]["appNumber"] if last["items"] else None
        item = await api.request("POST", f"/api/inboxes/{_path(found['id'])}/send", json={"appNumber": app_number, "body": text})
        return await sent(item, wait_for_delivery_seconds)

    @server.tool(annotations=WRITE)
    async def send_fax_to_app(
        inbox: Annotated[str, Field(description="The fax number to send from, E.164 (created if new).")],
        title: Annotated[str, Field(description="Document title.")] = "Fax",
        pages: Annotated[int, Field(ge=1, le=50)] = 1,
        app_number: Annotated[str | None, Field(description="The app's fax number. Default: the app's fax number from get_setup.")] = None,
        wait_for_delivery_seconds: DeliveryWait = 5,
    ) -> dict[str, Any]:
        """Fax the app from an inbox's number. The app receives the provider's inbound fax webhook (Telnyx:
        fax.received, with a PDF it can download). Returns the fax and how the app's webhook handler responded."""
        found = await ensure_inbox(inbox, "fax")
        item = await api.request(
            "POST", f"/api/inboxes/{_path(found['id'])}/send", json={"appNumber": app_number, "title": title, "pages": pages}
        )
        return await sent(item, wait_for_delivery_seconds)

    # ----------------------------------------------------------- webhooks

    @server.tool(annotations=READ)
    async def list_webhook_deliveries(
        message_id: Annotated[str | None, Field(description="Only deliveries for this message.")] = None,
        failed_only: Annotated[bool, Field(description="Only attempts the app didn't accept (non-2xx or no connection).")] = False,
        limit: Annotated[int, Field(ge=1, le=50)] = 10,
    ) -> dict[str, Any]:
        """Webhook attempts Phonybox made to the app (inbound messages, delivery receipts, fax events), newest first,
        with the app's HTTP status. Use it to check the app's webhook handlers."""
        if message_id:
            attempts = await api.request("GET", f"/api/items/{_path(message_id)}/webhooks")
            attempts = sorted(attempts, key=lambda w: (w["createdAt"], w["attempt"]), reverse=True)
            if failed_only:
                attempts = [w for w in attempts if not (w["status"] and 200 <= w["status"] < 300)]
            return {"deliveries": [delivery(w) for w in attempts[:limit]]}
        page = await api.request("GET", "/api/webhooks", params={"failed": failed_only, "limit": limit})
        return {"total": page["total"], "deliveries": [delivery(w) for w in page["items"]]}

    @server.tool(annotations=READ)
    async def get_webhook_delivery(delivery_id: Annotated[str, Field(description="A delivery id from list_webhook_deliveries.")]) -> dict[str, Any]:
        """One webhook attempt in full: the exact request Phonybox sent (headers, signed body) and the app's response."""
        w = await api.request("GET", f"/api/webhooks/{_path(delivery_id)}")
        return delivery(w) | {
            "request_headers": dict(w["requestHeaders"]),
            "request_body": _clip(w["requestBody"], 8000),
            "response": _clip(w.get("responseBody") or "", 4000),
        }

    @server.tool(annotations=WRITE)
    async def replay_webhook(delivery_id: Annotated[str, Field(description="A delivery id from list_webhook_deliveries.")]) -> dict[str, Any]:
        """Re-send a recorded webhook to the app, byte for byte (same signature), once. Use it after fixing a handler."""
        return delivery(await api.request("POST", f"/api/webhooks/{_path(delivery_id)}/replay"))

    @server.tool(annotations=READ)
    async def list_api_requests(
        provider: Annotated[str | None, Field(description="Only this provider, e.g. mailgun or telnyx.")] = None,
        limit: Annotated[int, Field(ge=1, le=50)] = 10,
    ) -> dict[str, Any]:
        """Provider API calls the app made to Phonybox (sending email, texts, faxes), newest first, with the status
        Phonybox returned and the error body for failures. Use it when a message doesn't arrive."""
        page = await api.request("GET", "/api/requests", params={"adapter": provider, "limit": limit})
        out = []
        for r in page["items"]:
            entry: dict[str, Any] = {
                "provider": r["adapterId"], "method": r["method"], "path": r["path"], "status": r["status"], "at": r["createdAt"],
            }
            if r.get("relatedId"):
                entry["message_id"] = r["relatedId"]
            if r["status"] >= 400:
                full = await api.request("GET", f"/api/requests/{_path(r['id'])}")
                entry["response"] = _clip(full.get("responseBody") or "", 1000)
            out.append(entry)
        return {"total": page["total"], "requests": out}

    return server


# ------------------------------------------------------------------ transports


class _LocalOriginsOnly:
    """Browsers send an Origin header; MCP clients don't. Refuse cross-site browser requests to /mcp, which also
    stops DNS-rebinding attacks, without restricting the Host header (Docker and Compose use other hostnames)."""

    def __init__(self, app: ASGIApp, hosts: set[str]) -> None:
        self.app = app
        self.hosts = hosts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            origin = Headers(scope=scope).get("origin")
            if origin and urlsplit(origin).hostname not in self.hosts:
                await JSONResponse({"error": "Cross-origin requests to /mcp are not allowed."}, status_code=403)(scope, receive, send)
                return
        await self.app(scope, receive, send)


def mount(app: FastAPI, emu: Emulator) -> MCPServer:
    """Serve the MCP server at /mcp on the control app. Run `server.session_manager.run()` while serving."""
    api = Api(httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://phonybox"), emu.cfg.base_url, "this server")
    server = build_server(api)
    http_app = server.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,  # each call stands alone: no sessions to lose when Phonybox restarts
        json_response=True,
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),  # see _LocalOriginsOnly
    )
    endpoint = next(r.endpoint for r in http_app.routes if isinstance(r, Route) and r.path == "/mcp")
    hosts = {"localhost", "127.0.0.1", "::1", *(h for h in (emu.cfg.public_host, emu.cfg.host) if h)}
    app.router.routes.append(Route("/mcp", endpoint=_LocalOriginsOnly(endpoint, hosts), include_in_schema=False))
    return server


def run_stdio(url: str) -> None:
    """`phonybox mcp`: the same tools over stdio, against a Phonybox running at `url`."""
    base = url.rstrip("/")
    parts = urlsplit(base)

    async def main() -> None:
        async with httpx.AsyncClient(base_url=base) as http:
            api = Api(http, lambda port: f"{parts.scheme}://{parts.hostname}:{port}", base)
            await build_server(api).run_stdio_async()

    asyncio.run(main())
