"""The suite is only useful nightly if the same inputs give the same bytes.
These tests prove it: identical runs produce identical state and webhooks, and
the seed actually controls the generated data."""

from __future__ import annotations

import hashlib
import json

import httpx

from phonybox.clock import FrozenClock
from phonybox.config import Config
from phonybox.emulator import Emulator
from phonybox.ids import Ids
from tests.support.db import database
from tests.support.fakes import DOMAIN, START, FakeApp

TABLES = {
    "inboxes": "id", "inbox_tags": "inbox_id, tag", "items": "seq", "blobs": "item_id, idx", "webhooks": "seq",
    "chains": "related_id, event", "requests": "seq", "adapters": "id", "opt_outs": "peer_number, app_number", "mg_events": "seq", "mg_routes": "id",
}


def digest(emu: Emulator) -> str:
    h = hashlib.sha256()
    for table, order in TABLES.items():
        rows = emu.store.db.execute(f"SELECT * FROM {table} ORDER BY {order}").fetchall()
        h.update(json.dumps([[v.hex() if isinstance(v, bytes) else v for v in tuple(r)] for r in rows], default=str).encode())
    return h.hexdigest()


async def scenario(dataset: str = "small") -> tuple[str, list[bytes]]:
    app = FakeApp()
    app.respond("/webhooks/telnyx/messaging", 500, 200)
    emu = Emulator(Config(dataset=dataset, db_path=database()), clock=FrozenClock(START), ids=Ids(seed=1), transport=httpx.MockTransport(app.handler))
    mg = httpx.AsyncClient(transport=httpx.ASGITransport(app=emu.mailgun), base_url="http://127.0.0.1:4101", auth=("api", "k"))
    tx = httpx.AsyncClient(transport=httpx.ASGITransport(app=emu.telnyx), base_url="http://127.0.0.1:4102", headers={"authorization": "Bearer k"})
    ctl = httpx.AsyncClient(transport=httpx.ASGITransport(app=emu.control), base_url="http://127.0.0.1:4100")
    await mg.post(f"/v3/{DOMAIN}/messages", data={"from": "a@mg.acme.test", "to": ["x@inbox.test", "bounce@inbox.test"], "subject": "Hi", "text": "code 1234"})
    await tx.post("/v2/messages", json={"from": "+16285550100", "to": "+14155550142", "text": "hello"})
    await tx.post("/v2/faxes", json={"connection_id": "c", "from": "+16285550150", "to": "+12125550199", "media_url": "http://x.test/a.pdf"})
    inbox = (await ctl.post("/api/inboxes", json={"channel": "email"})).json()
    await ctl.post(f"/api/inboxes/{inbox['id']}/send", json={"subject": "Q", "text": "?"})
    await emu.run_until_idle()
    out = digest(emu), [r.content for r in app.received]
    for c in (mg, tx, ctl):
        await c.aclose()
    await emu.aclose()
    return out


async def test_identical_runs_produce_identical_state_and_webhooks() -> None:
    a, b = await scenario(), await scenario()
    assert a[0] == b[0], "database state differs between identical runs"
    assert a[1] == b[1], "webhook bytes differ between identical runs"
    assert len(a[1]) >= 9


def test_large_seed_is_a_function_of_the_seed() -> None:
    def build(seed: int) -> str:
        return digest(Emulator(Config(dataset="large", generator_seed=seed, db_path=database()), clock=FrozenClock(START), ids=Ids(seed=1)))

    first = build(7)
    assert first == build(7)
    assert first != build(8)


def test_seeded_ids_differ_from_unseeded() -> None:
    assert Ids(seed=1).hex(16) == Ids(seed=1).hex(16)
    assert Ids().hex(16) != Ids().hex(16)
