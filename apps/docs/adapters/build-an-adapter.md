# Build an adapter

This guide adds a provider end to end, using **Postmark** (email) as the example. The same steps apply to an SMS, fax or voice provider. A typical adapter is one Python module of 150–300 lines, a UI manifest, a few JSON Schemas and a test module.

::: tip Before you start
Open an [adapter request](https://github.com/rohitlavu11/phonybox/issues/new?template=adapter_request.yml) so we can agree on scope (which endpoints and webhooks are in the first version). Partial adapters are fine as long as what's there matches the provider exactly.
:::

## How adapters fit in

```
your app ──SDK──▶ adapter routes (own port) ──▶ emu.store.add_item(...) ──▶ inbox
                                            └─▶ emu.deliverer.enqueue(...) ──▶ webhook to your app
inbox "send" ──▶ adapter.send_to_app(...) ──────▶ emu.deliverer.enqueue(...) ──▶ webhook to your app
```

The core gives you:

| Helper | Use it for |
| --- | --- |
| `emu.inbox_for(channel, address, adapter_id)` | The inbox that should receive a message (created automatically when allowed). |
| `emu.store.add_item(item, heavy, blobs)` | Store a message. `item` is the list-level JSON; `heavy` holds `html` / `headers`; `blobs` are attachments. |
| `emu.deliverer.enqueue(...)` | Send a webhook with retries, recording every attempt. `build(attempt, at)` returns `(headers, body)` and is called per attempt so signatures are fresh. |
| `emu.scheduler.after(seconds, job)` | Run something later (delivery receipts, lifecycles). Time comes from the injected clock, so tests can freeze it. |
| `emu.ids`, `emu.clock` | IDs and time. Never call `uuid4()` or `datetime.now()` directly; tests depend on determinism. |
| `install_request_log(app, emu, ID, disabled)` | Records calls in the API log and returns `disabled()` while the adapter is switched off. |
| `emu.store.adapter_state(ID)["values"]` | Your adapter's current settings (cached; edited in the UI). |

## 1. The server module

Create `apps/server/src/phonybox/adapters/postmark.py`:

```python
"""Postmark emulation: POST /email, Delivery webhooks, inbound webhooks."""

from __future__ import annotations

import json
from datetime import datetime
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from ..clock import iso
from ..text import parse_addresses
from .base import AdapterSpec
from .common import install_request_log

if TYPE_CHECKING:
    from ..emulator import Emulator
    from ..models import SendToApp

ID = "postmark"

DEFAULTS: dict[str, str | bool] = {
    "acceptAnyKey": True,
    "serverToken": "local-postmark-server-token",
    "deliveryUrl": "http://localhost:3000/webhooks/postmark/delivery",
    "inboundUrl": "http://localhost:3000/webhooks/postmark/inbound",
}


def settings(emu: Emulator) -> dict[str, Any]:
    return emu.store.adapter_state(ID)["values"]


def error(status: int, code: int, message: str) -> JSONResponse:
    # Postmark's error shape: {"ErrorCode": n, "Message": "..."}
    return JSONResponse({"ErrorCode": code, "Message": message}, status_code=status)


def build_app(emu: Emulator) -> FastAPI:
    app = FastAPI(title="Postmark (phonybox)", docs_url=None, redoc_url=None, openapi_url=None)
    install_request_log(app, emu, ID, lambda: error(503, 503, "Postmark adapter is disabled"))

    @app.post("/email")
    async def send(request: Request) -> Response:
        token = request.headers.get("x-postmark-server-token")
        if not token or (not settings(emu)["acceptAnyKey"] and token != settings(emu)["serverToken"]):
            return error(401, 10, "No Account or Server API tokens were supplied in the HTTP headers.")
        body = await request.json()
        recipients = parse_addresses([body.get("To", "")])
        if not recipients:
            return error(422, 300, "Invalid 'To' address.")

        at = emu.clock.now()
        message_id = emu.ids.uuid()
        sender = parse_addresses([body.get("From", "")])[0]
        for r in recipients:
            inbox = emu.inbox_for("email", r["address"], ID)
            item = {
                "id": emu.ids.short("em"), "channel": "email", "inboxId": inbox["id"], "adapterId": ID,
                "direction": "outbound", "messageId": f"<{message_id}@postmark.local>", "from": sender, "to": [r],
                "subject": body.get("Subject", ""), "text": body.get("TextBody", ""), "attachments": [], "headers": [],
                "tags": [body["Tag"]] if body.get("Tag") else [], "status": "delivered", "read": False, "createdAt": iso(at),
            }
            emu.store.add_item(item, {"html": body["HtmlBody"]} if body.get("HtmlBody") else None)
            request.state.related_id = item["id"]

            delivery = {"RecordType": "Delivery", "MessageID": message_id, "Recipient": r["address"], "Tag": body.get("Tag", ""),
                        "DeliveredAt": iso(at), "Details": "Captured by phonybox", "MessageStream": body.get("MessageStream", "outbound")}
            emu.deliverer.enqueue(
                adapter_id=ID, channel="email", event="Delivery", url=str(settings(emu)["deliveryUrl"]),
                related_id=item["id"], delay=emu.cfg.event_delay,
                build=lambda _attempt, _at, d=delivery: ([("content-type", "application/json")], json.dumps(d).encode()),
            )

        return JSONResponse({"To": body["To"], "SubmittedAt": iso(at), "MessageID": message_id, "ErrorCode": 0, "Message": "OK"})

    @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def not_emulated(path: str) -> Response:
        return error(404, 404, f"/{path} is not emulated by phonybox")

    return app


def send_to_app(emu: Emulator, inbox: dict[str, Any], body: SendToApp) -> dict[str, Any]:
    """An inbox emails your app: Postmark's inbound webhook."""
    if not body.text:
        raise HTTPException(422, "text is required")
    at = emu.clock.now()
    item = {
        "id": emu.ids.short("em"), "channel": "email", "inboxId": inbox["id"], "adapterId": ID, "direction": "inbound",
        "messageId": f"<{emu.ids.uuid()}@inbox.test>", "from": {"address": inbox["address"]},
        "to": [{"address": body.to or "support@example.test"}], "subject": body.subject or "", "text": body.text,
        "attachments": [], "headers": [], "tags": [], "status": "delivered", "read": True, "createdAt": iso(at),
    }
    emu.store.add_item(item)
    payload = {"From": inbox["address"], "To": item["to"][0]["address"], "Subject": item["subject"], "TextBody": body.text,
               "StrippedTextReply": body.text, "MessageID": item["messageId"].strip("<>"), "Date": iso(at), "Headers": [], "Attachments": []}
    emu.deliverer.enqueue(
        adapter_id=ID, channel="email", event="Inbound", url=str(settings(emu)["inboundUrl"]), related_id=item["id"],
        build=lambda _attempt, _at: ([("content-type", "application/json")], json.dumps(payload).encode()),
    )
    return item


ADAPTER = AdapterSpec(
    id=ID,
    name="Postmark",
    channels=("email",),
    port_offset=3,                     # :4103
    # Shown to agents by the MCP get_setup tool; {url} becomes this adapter's base URL.
    sdk_setup="postmark.js: new postmark.ServerClient(token) with apiUrl '{url}'. Plain HTTP: POST {url}/email.",
    defaults=lambda emu: dict(DEFAULTS),
    build_app=build_app,
    send_to_app=send_to_app,
)
```

`sdk_setup` is optional but worth a line: it's how an agent using the [MCP server](/guide/mcp) learns to point your app's SDK at the adapter.

Postmark doesn't sign webhooks. Providers that do (Mailgun, Telnyx, Twilio, SendGrid) should sign inside `build`, the way `mailgun.py` and `telnyx.py` do, so a retry is re-signed with a fresh timestamp.

## 2. Register it

In `apps/server/src/phonybox/adapters/__init__.py`:

```python
from . import mailgun, postmark, telnyx

REGISTRY = {spec.id: spec for spec in (mailgun.ADAPTER, telnyx.ADAPTER, postmark.ADAPTER)}
```

That's all the server needs. The control API, settings storage, reset/seed, webhook log, retries and the startup banner all read the registry. Run `uv run phonybox` and you'll see `Postmark http://127.0.0.1:4103`.

Optional: implement `seed_event` and `seed_request` on the spec so the demo seed can include realistic Postmark history. See `mailgun.py` for the pattern.

## 3. The UI manifest

The inspector draws the adapter page (connect snippets, endpoint list, settings form, inbound events) from a manifest. Create `apps/web/src/adapters/postmark.ts`:

```ts
import { defineAdapter } from "./define"

export const postmark = defineAdapter({
  id: "postmark",
  name: "Postmark",
  monogram: "Pm",
  description: "Email API and inbound processing.",
  channels: ["email"],
  port: 4103,
  apiPrefix: "",
  version: "0.1.0",
  docsUrl: "https://postmarkapp.com/developer",
  outbound: [{ method: "POST", path: "/email", summary: "Send a single email", channel: "email", support: "full" }],
  inbound: [
    { event: "Delivery", channel: "email", trigger: "An outbound email lands in an inbox", urlSetting: "deliveryUrl" },
    { event: "Inbound", channel: "email", trigger: "An inbox emails your app", urlSetting: "inboundUrl" },
  ],
  settings: [
    { key: "acceptAnyKey", label: "Accept any server token", kind: "toggle", defaultValue: true, group: "auth" },
    { key: "serverToken", label: "Server token", kind: "secret", defaultValue: "local-postmark-server-token", group: "auth" },
    { key: "deliveryUrl", label: "Delivery webhook URL", kind: "url", defaultValue: "http://localhost:3000/webhooks/postmark/delivery", group: "inbound" },
    { key: "inboundUrl", label: "Inbound webhook URL", kind: "url", defaultValue: "http://localhost:3000/webhooks/postmark/inbound", group: "inbound" },
  ],
  connect: [
    { label: ".env", language: "dotenv", code: "POSTMARK_API_URL=http://127.0.0.1:4103\nPOSTMARK_SERVER_TOKEN=local-postmark-server-token" },
  ],
})
```

Add it to `adapters` in `apps/web/src/adapters/index.ts` (and drop it from `plannedAdapters`). Setting keys must match `DEFAULTS` on the server.

## 4. Contracts

Write JSON Schemas for the provider's documented shapes in `contracts/providers/`, named `postmark.<thing>.schema.json`: the send response, the error shape and each webhook body. Write them **from the provider's docs, not from your code**. They're how the suite catches you drifting from the real API.

## 5. Tests

Add `apps/server/tests/contract/test_postmark.py`. Tests in `tests/contract/` run deterministically (frozen clock, seeded IDs, in-process webhooks) and nightly against SQLite and PostgreSQL.

```python
import httpx

from tests.support.contracts import conforms


async def test_send_lands_in_inbox_and_sends_delivery(emu, control, fake_app):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=emu.adapter_apps["postmark"]), base_url="http://127.0.0.1:4103",
        headers={"X-Postmark-Server-Token": "t"},
    ) as postmark:
        r = await postmark.post("/email", json={"From": "a@acme.test", "To": "riley@inbox.test", "Subject": "Hi", "TextBody": "x"})
    assert r.status_code == 200
    conforms("postmark.send-response", r.json())

    await emu.advance(emu.cfg.event_delay)
    [delivery] = fake_app.json_to("/webhooks/postmark/delivery")
    conforms("postmark.delivery-webhook", delivery)
```

Cover at least: a successful send, every error you emulate, each webhook (shape and, if signed, signature), and `send_to_app`. Use the `golden` fixture for exact payload snapshots.

If the provider has an official Python SDK, add a test in `tests/live/test_sdks.py` that drives your adapter with it. The nightly job runs it against the latest SDK release too.

## 6. Docs

Add `apps/docs/adapters/postmark.md` (endpoints, webhooks, settings) and link it from the sidebar in `apps/docs/.vitepress/config.ts` and the table in `adapters/index.md`.

## Checklist

- [ ] `adapters/<id>.py` exports `ADAPTER`, registered in `adapters/__init__.py`
- [ ] Responses and errors match the provider's docs (status codes, field names, error bodies)
- [ ] IDs and time come from `emu.ids` and `emu.clock`
- [ ] Webhooks signed like the provider, built per attempt
- [ ] UI manifest added and registered
- [ ] Schemas in `contracts/providers/`, tests in `tests/contract/`
- [ ] `uv run pytest` passes, and with `PHONYBOX_TEST_DATABASE_URL` set to a Postgres URL
- [ ] Docs page
