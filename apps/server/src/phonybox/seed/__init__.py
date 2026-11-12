"""Seed data. Webhook and API-log rows are built with the adapters' own payload
builders, so seeded history has exactly the shape live traffic does."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from .. import adapters
from ..adapters.common import stable_uuid
from ..clock import iso
from ..config import Dataset

if TYPE_CHECKING:
    from ..emulator import Emulator

#: (status, response body, error). status None = connection failed.
Attempt = tuple[int | None, str | None, str | None]
OK: Attempt = (200, '{"ok":true}', None)


@dataclass
class SeedItem:
    item: dict[str, Any]
    heavy: dict[str, Any] | None = None
    #: Webhook attempts for this item's main event, oldest first.
    attempts: list[Attempt] = field(default_factory=lambda: [OK])
    #: Record the app's API call that created it (outbound only).
    request: bool = True


@dataclass
class SeedData:
    inboxes: list[dict[str, Any]]
    items: list[SeedItem]


def catch_all(at: datetime) -> dict[str, Any]:
    return {
        "id": "catch-all", "channel": "email", "address": "*", "label": "Catch-all", "adapterId": "mailgun", "catchAll": True,
        "tags": [], "createdBy": "seed", "createdAt": iso(at),
    }


def load(emu: Emulator, dataset: Dataset) -> None:
    from . import generate, handwritten

    now = emu.clock.now()
    data = SeedData(inboxes=[catch_all(now - timedelta(days=1))], items=[])
    if dataset in ("small", "large"):
        hw = handwritten.build(now)
        data.inboxes = hw.inboxes
        data.items = hw.items
    if dataset == "large":
        gen = generate.build(now, emu.cfg.generator_seed)
        data.inboxes += gen.inboxes
        data.items += gen.items

    emu.store.wipe()
    with emu.store.tx() as db:
        for spec in adapters.REGISTRY.values():
            values = {k: emu.cfg.webhook_url(v) if isinstance(v, str) else v for k, v in spec.defaults(emu).items()}
            emu.store.put_adapter(spec.id, True, values, db)
        emu.store.insert_inboxes(data.inboxes, db)
        emu.store.insert_items([(s.item, s.heavy) for s in data.items], db)

        hooks: list[dict[str, Any]] = []
        requests: list[dict[str, Any]] = []
        for s in data.items:
            hooks += _hooks(emu, s)
            if s.request and (req := _request(s.item)):
                requests.append(req)
        hooks.sort(key=lambda w: (w["createdAt"], w["attempt"]))
        emu.store.insert_webhooks(hooks, db)
        emu.store.insert_requests(sorted(requests, key=lambda r: r["createdAt"]), db)
        emu.store.recount_all(db)
    emu.store.bus.publish("inboxes", "items", "webhooks", "requests", "adapters")


def _hooks(emu: Emulator, s: SeedItem) -> list[dict[str, Any]]:
    """Webhook attempts a seeded item would have produced, built by its adapter."""
    it = s.item
    spec = adapters.get(it["adapterId"])
    if spec.seed_event is None:
        return []
    at0 = datetime.fromisoformat(it["createdAt"].replace("Z", "+00:00")) + timedelta(seconds=1)
    event, url, build = spec.seed_event(emu, it, s.heavy, at0)

    out = []
    for n, (status, response, error) in enumerate(s.attempts, start=1):
        at = at0 + timedelta(seconds=sum(([0.0] + emu.cfg.retry_delays)[:n]))
        headers, body = build(n, at)
        w: dict[str, Any] = {
            "id": f"wh-{stable_uuid(it['id'], str(n))[:8]}", "adapterId": it["adapterId"], "channel": it["channel"], "event": event, "url": url,
            "status": status, "durationMs": 3 if status is None else 12 + (n * 7) % 40, "attempt": n, "maxAttempts": emu.cfg.max_attempts,
            "createdAt": iso(at), "relatedId": it["id"], "requestHeaders": headers, "requestBody": body.decode(),
        }
        if response is not None:
            w["responseBody"] = response
        if error:
            w["error"] = error
        out.append(w)
    return out


def _request(it: dict[str, Any]) -> dict[str, Any] | None:
    """The API call your app would have made to create a seeded outbound item."""
    spec = adapters.get(it["adapterId"])
    at = datetime.fromisoformat(it["createdAt"].replace("Z", "+00:00")) - timedelta(milliseconds=40)
    req = spec.seed_request(it, at) if spec.seed_request else None
    if req is None:
        return None
    return {"id": f"rq-{stable_uuid(it['id'], 'rq')[:8]}", "adapterId": it["adapterId"], "createdAt": iso(at), "relatedId": it["id"], "durationMs": 9, **req}
