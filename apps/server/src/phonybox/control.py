"""Control API: what the inspector UI and agents use. Mounted at /api on the control port.

Every route declares a response model, so the generated OpenAPI document is the
contract. It is snapshotted in contracts/control-api.openapi.json; the nightly
suite fails if it changes without the snapshot being updated, and the UI's
TypeScript types are checked against it.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Any

from fastapi import Body, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from . import adapters as registry
from .clock import iso
from .models import (
    AdapterPatch,
    AdapterState,
    ApiRequest,
    BulkRequest,
    BulkResult,
    ChannelId,
    ChannelStats,
    ConversationPage,
    Count,
    Direction,
    Extracted,
    Health,
    InboxFilter,
    InboxPage,
    InboxSort,
    InboxSummary,
    Item,
    ItemPage,
    NewInbox,
    RequestPage,
    ResetRequest,
    SendToApp,
    SetRead,
    SmsMessage,
    WaitResult,
    WebhookDelivery,
    WebhookPage,
    WebhookTarget,
)
from .text import E164, extract

if TYPE_CHECKING:
    from .emulator import Emulator

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

Cursor = Annotated[int, Query(ge=0, description="Offset from a previous page's nextCursor.")]
Limit = Annotated[int, Query(ge=1, le=500)]


def build_control_app(emu: Emulator) -> FastAPI:
    app = FastAPI(
        title="phonybox control API",
        version=__version__,
        description="Inboxes, captured messages, webhook and API logs. Used by the inspector UI and by agents.",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )

    def inbox_or_404(key: str) -> dict[str, Any]:
        inbox = emu.store.get_inbox(key)
        if not inbox:
            raise HTTPException(404, f"No inbox with id or address {key!r}")
        return inbox

    def item_or_404(item_id: str) -> dict[str, Any]:
        item = emu.store.get_item(item_id)
        if not item:
            raise HTTPException(404, f"No item {item_id!r}")
        return item

    # --------------------------------------------------------------- meta

    @app.get("/api/health", response_model=Health, tags=["meta"])
    async def health() -> dict[str, Any]:
        return {
            "ok": True,
            "version": __version__,
            "dataset": emu.dataset,
            "ports": {name: port for name, (_, port) in emu.apps().items()},
        }

    @app.get("/api/stats", response_model=list[ChannelStats], tags=["inboxes"])
    async def stats() -> list[dict[str, Any]]:
        return emu.store.channel_stats()

    @app.post("/api/reset", response_model=Health, tags=["meta"])
    async def reset(body: ResetRequest | None = None) -> dict[str, Any]:
        emu.reset((body.dataset if body else None) or emu.dataset)
        return await health()

    # ------------------------------------------------------------ inboxes

    @app.get("/api/inboxes", response_model=InboxPage, tags=["inboxes"])
    async def list_inboxes(
        channel: ChannelId | None = None,
        q: str | None = Query(None, description="Matches address and label. `tag:run:42` matches tags by prefix."),
        filter: InboxFilter = "all",
        sort: InboxSort = "activity",
        cursor: Cursor = 0,
        limit: Limit = 100,
    ) -> dict[str, Any]:
        return emu.store.list_inboxes({"channel": channel, "q": q, "filter": filter, "sort": sort}, cursor, limit)

    def _new(n: NewInbox, created_by: str) -> dict[str, Any]:
        address = (n.address or "").strip()
        if not address:
            address = emu.free_address(n.channel)
        elif n.channel == "email":
            address = address.lower()
            if not EMAIL.match(address):
                raise HTTPException(422, f"{address!r} is not an email address")
        else:
            address = re.sub(r"[^\d+]", "", address)
            if not E164.match(address):
                raise HTTPException(422, f"{n.address!r} is not an E.164 number")
        return {
            "id": emu.inbox_id(n.channel, address),
            "channel": n.channel,
            "address": address,
            **({"label": n.label} if n.label else {}),
            "adapterId": n.adapter_id or registry.for_channel(n.channel).id,
            "tags": [t.strip() for t in n.tags if t.strip()],
            "createdBy": created_by,
            "createdAt": iso(emu.clock.now()),
        }

    @app.post("/api/inboxes", response_model=InboxSummary | list[InboxSummary], status_code=201, tags=["inboxes"])
    async def create_inboxes(request: Request, body: NewInbox | list[NewInbox]) -> Any:
        """One object creates one inbox (409 if the address exists). An array creates many, skipping existing addresses."""
        by = "ui" if request.headers.get("x-phonybox-client") == "ui" else "agent"
        if isinstance(body, list):
            return emu.store.create_inboxes([_new(n, by) for n in body])
        made = emu.store.create_inboxes([_new(body, by)])
        if not made:
            raise HTTPException(409, "An inbox with that address already exists")
        return made[0]

    @app.post("/api/inboxes/bulk", response_model=BulkResult, tags=["inboxes"])
    async def bulk(body: BulkRequest) -> dict[str, int]:
        """Apply an operation to explicit ids, or to every inbox matching a query minus `except`."""
        if body.ids is None and body.query is None:
            raise HTTPException(422, "Pass ids, or query (+ except)")
        query = body.query.model_dump(by_alias=True) if body.query else None
        ids = emu.store.selection_ids(body.ids, query, body.except_)
        n = {
            "delete": emu.store.delete_inboxes,
            "clear": emu.store.clear_inboxes,
            "read": emu.store.mark_inboxes_read,
            "pin": lambda i: emu.store.set_pinned(i, True),
            "unpin": lambda i: emu.store.set_pinned(i, False),
        }[body.op](ids)
        return {"affected": n}

    @app.get("/api/inboxes/{inbox}", response_model=InboxSummary, tags=["inboxes"])
    async def get_inbox(inbox: str) -> dict[str, Any]:
        """`inbox` is an id or an address (email or E.164 number)."""
        return inbox_or_404(inbox)

    @app.delete("/api/inboxes/{inbox}", response_model=BulkResult, tags=["inboxes"])
    async def delete_inbox(inbox: str) -> dict[str, int]:
        found = inbox_or_404(inbox)
        return {"affected": emu.store.delete_inboxes([found["id"]])}

    @app.get("/api/inboxes/{inbox}/messages", response_model=ItemPage, tags=["agents"])
    async def inbox_messages(inbox: str, direction: Direction | None = None, q: str | None = None, since: str | None = None, cursor: Cursor = 0, limit: Limit = 100) -> dict[str, Any]:
        found = inbox_or_404(inbox)
        return emu.store.list_items({"channel": found["channel"], "inboxId": found["id"], "direction": direction, "q": q, "since": since}, cursor, limit)

    @app.get("/api/inboxes/{inbox}/wait", response_model=WaitResult, tags=["agents"], responses={408: {"description": "Nothing matched before the timeout"}})
    async def wait(
        inbox: str,
        timeout: float = Query(30, ge=0, le=300),
        subject: str | None = Query(None, description="Case-insensitive substring of the subject (email) or body (sms) or title (fax)."),
        direction: Direction = "outbound",
        since: str | None = Query(None, description="Only items created after this ISO timestamp."),
    ) -> dict[str, Any]:
        """Long-poll until the inbox has a matching item, then return the newest one with its codes and links."""
        found = inbox_or_404(inbox)
        q = emu.bus.subscribe()
        try:
            deadline = asyncio.get_running_loop().time() + timeout
            while True:
                page = emu.store.list_items({"channel": found["channel"], "inboxId": found["id"], "direction": direction, "since": since}, 0, 50)
                for it in page["items"]:
                    hay = (it.get("subject") or it.get("body") or it.get("title") or "").lower()
                    if not subject or subject.lower() in hay:
                        full = emu.store.get_item(it["id"]) or it
                        return {"item": full, "extract": extract(full.get("text") or full.get("body") or "")}
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    raise HTTPException(408, f"No matching item in {found['address']} within {timeout:g}s")
                try:
                    await asyncio.wait_for(q.get(), remaining)
                except TimeoutError:
                    pass
        finally:
            emu.bus.unsubscribe(q)

    @app.post("/api/inboxes/{inbox}/send", response_model=Item, status_code=201, tags=["agents"])
    async def send_to_app(inbox: str, body: SendToApp) -> dict[str, Any]:
        """Send from this inbox to your app. Delivered as the inbox adapter's inbound webhook."""
        found = inbox_or_404(inbox)
        if not emu.store.adapter_state(found["adapterId"])["enabled"]:
            raise HTTPException(409, f"The {found['adapterId']} adapter is off")
        return registry.get(found["adapterId"]).send_to_app(emu, found, body)

    # -------------------------------------------------------------- items

    @app.get("/api/items", response_model=ItemPage, tags=["items"])
    async def list_items(
        channel: ChannelId,
        inbox: str | None = Query(None, description="Inbox id; omit for every inbox on the channel."),
        direction: Direction | None = None,
        q: str | None = None,
        cursor: Cursor = 0,
        limit: Limit = 100,
    ) -> dict[str, Any]:
        return emu.store.list_items({"channel": channel, "inboxId": inbox, "direction": direction, "q": q}, cursor, limit)

    @app.patch("/api/items", response_model=BulkResult, tags=["items"])
    async def set_read(body: SetRead) -> dict[str, int]:
        return {"affected": emu.store.set_items_read(body.ids, body.read)}

    @app.get("/api/items/{item_id}", response_model=Item, tags=["items"])
    async def get_item(item_id: str) -> dict[str, Any]:
        return item_or_404(item_id)

    @app.delete("/api/items/{item_id}", response_model=BulkResult, tags=["items"])
    async def delete_item(item_id: str) -> dict[str, int]:
        return {"affected": int(emu.store.delete_item(item_id))}

    @app.get("/api/items/{item_id}/extract", response_model=Extracted, tags=["agents"])
    async def item_extract(item_id: str) -> dict[str, Any]:
        it = item_or_404(item_id)
        return extract(it.get("text") or it.get("body") or "")

    @app.get("/api/items/{item_id}/webhooks", response_model=list[WebhookDelivery], tags=["items"])
    async def item_webhooks(item_id: str) -> list[dict[str, Any]]:
        return emu.store.webhooks_for(item_id)

    @app.get("/api/items/{item_id}/request", response_model=ApiRequest | None, tags=["items"])
    async def item_request(item_id: str) -> dict[str, Any] | None:
        return emu.store.request_for(item_id)

    @app.get("/api/items/{item_id}/attachments/{idx}", tags=["items"], response_class=Response)
    async def attachment(item_id: str, idx: int) -> Response:
        blob = emu.store.blob(item_id, idx)
        if not blob:
            raise HTTPException(404, "No such attachment (seeded items have metadata only)")
        return Response(blob[2], media_type=blob[1], headers={"content-disposition": f'attachment; filename="{blob[0]}"'})

    @app.get("/api/sms/conversations", response_model=ConversationPage, tags=["items"])
    async def conversations(inbox: str | None = None, q: str | None = None, cursor: Cursor = 0, limit: Limit = 100) -> dict[str, Any]:
        return emu.store.conversations(inbox, q, cursor, limit)

    @app.get("/api/sms/conversations/{inbox}/{app_number}", response_model=list[SmsMessage], tags=["items"])
    async def thread(inbox: str, app_number: str) -> list[dict[str, Any]]:
        return emu.store.thread(inbox_or_404(inbox)["id"], app_number)

    # ----------------------------------------------------------- webhooks

    @app.get("/api/webhooks", response_model=WebhookPage, tags=["logs"])
    async def list_webhooks(adapter: str | None = None, failed: bool = False, q: str | None = None, cursor: Cursor = 0, limit: Limit = 100) -> dict[str, Any]:
        return emu.store.list_webhooks({"adapterId": adapter, "failedOnly": failed, "q": q}, cursor, limit)

    @app.get("/api/webhooks/targets", response_model=list[WebhookTarget], tags=["logs"])
    async def webhook_targets() -> list[dict[str, Any]]:
        return emu.store.webhook_targets()

    @app.get("/api/webhooks/latest", response_model=WebhookDelivery | None, tags=["logs"])
    async def latest_webhook() -> dict[str, Any] | None:
        return emu.store.latest_webhook()

    @app.get("/api/webhooks/failing", response_model=Count, tags=["logs"])
    async def failing() -> dict[str, int]:
        return {"count": emu.store.failing_count()}

    @app.get("/api/webhooks/{webhook_id}", response_model=WebhookDelivery, tags=["logs"])
    async def get_webhook(webhook_id: str) -> dict[str, Any]:
        w = emu.store.get_webhook(webhook_id)
        if not w:
            raise HTTPException(404, f"No webhook delivery {webhook_id!r}")
        return w

    @app.post("/api/webhooks/{webhook_id}/replay", response_model=WebhookDelivery, tags=["logs"])
    async def replay(webhook_id: str) -> dict[str, Any]:
        w = await emu.deliverer.replay(webhook_id)
        if not w:
            raise HTTPException(404, f"No webhook delivery {webhook_id!r}")
        return w

    @app.get("/api/requests", response_model=RequestPage, tags=["logs"])
    async def list_requests(adapter: str | None = None, q: str | None = None, cursor: Cursor = 0, limit: Limit = 100) -> dict[str, Any]:
        return emu.store.list_requests({"adapterId": adapter, "q": q}, cursor, limit)

    @app.get("/api/requests/{request_id}", response_model=ApiRequest, tags=["logs"])
    async def get_request(request_id: str) -> dict[str, Any]:
        r = emu.store.get_request(request_id)
        if not r:
            raise HTTPException(404, f"No request {request_id!r}")
        return r

    # ----------------------------------------------------------- adapters

    @app.get("/api/adapters", response_model=dict[str, AdapterState], tags=["adapters"])
    async def adapters() -> dict[str, Any]:
        return emu.store.adapter_states()

    @app.patch("/api/adapters/{adapter_id}", response_model=AdapterState, tags=["adapters"])
    async def patch_adapter(adapter_id: str, body: Annotated[AdapterPatch, Body()]) -> dict[str, Any]:
        if adapter_id not in emu.store.adapter_states():
            raise HTTPException(404, f"No adapter {adapter_id!r}")
        values = dict(body.values or {})
        values.pop("publicKey", None)  # derived from the signing key; read-only
        return emu.store.patch_adapter(adapter_id, body.enabled, values)

    # -------------------------------------------------------------- events

    @app.get("/api/events", tags=["meta"], response_class=StreamingResponse)
    async def events(request: Request) -> StreamingResponse:
        """Server-sent events. `change` events carry the topics that changed: inboxes, items, webhooks, requests, adapters."""
        q = emu.bus.subscribe()

        async def stream() -> AsyncIterator[str]:
            try:
                yield f"retry: 2000\nevent: hello\ndata: {json.dumps({'version': emu.bus.version})}\n\n"
                while not await request.is_disconnected():
                    try:
                        topics = set(await asyncio.wait_for(q.get(), 15))
                    except TimeoutError:
                        yield ": keep-alive\n\n"
                        continue
                    while not q.empty():
                        topics |= q.get_nowait()
                    yield f"event: change\ndata: {json.dumps({'topics': sorted(topics)})}\n\n"
            finally:
                emu.bus.unsubscribe(q)

        return StreamingResponse(stream(), media_type="text/event-stream", headers={"cache-control": "no-cache", "x-accel-buffering": "no"})

    # ----------------------------------------------------------------- MCP

    # /mcp: the same inboxes as tools for AI agents. Before the UI so its catch-all doesn't shadow it.
    from . import mcp_server

    app.state.mcp = mcp_server.mount(app, emu)

    # ------------------------------------------------------------------ UI

    dist = emu.cfg.ui_dist
    if dist and Path(dist, "index.html").exists():
        if Path(dist, "assets").is_dir():
            app.mount("/assets", StaticFiles(directory=Path(dist, "assets")), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str) -> FileResponse:
            file = Path(dist, path)
            return FileResponse(file if path and file.is_file() else Path(dist, "index.html"))

    return app
