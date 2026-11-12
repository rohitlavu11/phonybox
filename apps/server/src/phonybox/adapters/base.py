"""The adapter contract.

An adapter makes Phonybox look like one provider. It has two halves:

  outbound  routes your app calls (a FastAPI app on the adapter's own port).
            Handlers store what your app sent with `emu.store.add_item(...)`,
            routed to the right inbox by `emu.inbox_for(...)`.
  inbound   what your app receives: webhooks queued with
            `emu.deliverer.enqueue(...)`, including when someone sends from an
            inbox (`send_to_app`).

Every module in this package exports one `ADAPTER = AdapterSpec(...)` and is
listed in `adapters/__init__.py`. Nothing else in the server needs to change.
See docs/adapters/build-an-adapter.md.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import FastAPI

    from ..emulator import Emulator
    from ..models import SendToApp

Headers = list[tuple[str, str]]
#: Builds one webhook attempt: (attempt number, time of the attempt) -> (headers, body bytes).
#: Called per attempt, so timestamps and signatures are fresh, like a provider re-signing a retry.
BuildAttempt = Callable[[int, datetime], tuple[Headers, bytes]]


@dataclass(frozen=True)
class AdapterSpec:
    #: Stable id, used in URLs, settings and the UI manifest (e.g. "mailgun").
    id: str
    name: str
    #: Channels it serves: "email", "sms", "fax".
    channels: tuple[str, ...]
    #: Listens on control_port + port_offset unless a port is configured.
    port_offset: int
    #: Default settings (webhook URLs, keys, fault rules). Shown and editable in the UI.
    defaults: Callable[[Emulator], dict[str, str | bool]]
    #: The emulated provider API.
    build_app: Callable[[Emulator], FastAPI]
    #: An inbox sends something to your app (POST /api/inboxes/:id/send). Raise HTTPException for bad input.
    send_to_app: Callable[[Emulator, dict[str, Any], SendToApp], dict[str, Any]]
    #: Path the provider's SDK appends to its base URL (Telnyx: "/v2"). Display only.
    base_path: str = ""
    #: How to point the provider's official SDKs at this adapter, for people and agents (shown by the
    #: MCP `get_setup` tool). `{url}` is replaced with the adapter's base URL, including `base_path`.
    sdk_setup: str = ""
    #: Optional: the webhook a seeded item would have produced, so demo data has realistic history.
    #: (emu, item, heavy fields, first-attempt time) -> (event, url, build)
    seed_event: Callable[[Emulator, dict[str, Any], dict[str, Any] | None, datetime], tuple[str, str, BuildAttempt]] | None = None
    #: Optional: the API call your app would have made to create a seeded outbound item.
    seed_request: Callable[[dict[str, Any], datetime], dict[str, Any] | None] | None = None
