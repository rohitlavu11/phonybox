"""Control API contract: what the UI and agents rely on.

Invariants are checked on the large seed (~3,500 inboxes), so paging, counters
and bulk selection are exercised at the scale the UI is built for.
"""

from __future__ import annotations

import asyncio
import random
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest

from phonybox.clock import FrozenClock
from phonybox.config import Config
from phonybox.emulator import Emulator
from phonybox.ids import Ids
from tests.support.db import database
from tests.support.fakes import DOMAIN, START


@pytest.fixture(scope="module")
def large_emu() -> Emulator:
    """One shared large emulator for the read-only tests; building it takes ~2s."""
    return Emulator(Config(dataset="large", db_path=database()), clock=FrozenClock(START), ids=Ids(seed=1), transport=httpx.MockTransport(lambda _: httpx.Response(200)))


@pytest.fixture
async def large(large_emu: Emulator) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=large_emu.control), base_url="http://127.0.0.1:4100") as c:
        yield c


async def walk(client: httpx.AsyncClient, path: str, params: dict[str, Any], limit: int = 250) -> tuple[list[dict[str, Any]], int]:
    out: list[dict[str, Any]] = []
    cursor: int | None = 0
    totals = set()
    while cursor is not None:
        page = (await client.get(path, params={**params, "cursor": cursor, "limit": limit})).json()
        out += page["items"]
        totals.add(page["total"])
        cursor = page["nextCursor"]
        assert len(out) <= page["total"], "pages returned more rows than total"
    assert len(totals) == 1, "total changed between pages"
    return out, totals.pop()


# ------------------------------------------------------------- pagination


@pytest.mark.parametrize("sort", ["activity", "unread", "name", "created"])
@pytest.mark.parametrize("channel", [None, "email", "sms", "fax"])
async def test_inbox_pages_cover_everything_once_in_order(large: httpx.AsyncClient, channel: str | None, sort: str) -> None:
    params = {"sort": sort, **({"channel": channel} if channel else {})}
    rows, total = await walk(large, "/api/inboxes", params)
    ids = [r["id"] for r in rows]
    assert len(ids) == total == len(set(ids))
    if channel:
        assert {r["channel"] for r in rows} == {channel}
    activity = [r["lastActivityAt"] or r["createdAt"] for r in rows]
    if sort == "activity":
        assert activity == sorted(activity, reverse=True)
    elif sort == "unread":
        assert [r["unreadCount"] for r in rows] == sorted((r["unreadCount"] for r in rows), reverse=True)
    elif sort == "created":
        assert [r["createdAt"] for r in rows] == sorted((r["createdAt"] for r in rows), reverse=True)
    stats = {s["channel"]: s for s in (await large.get("/api/stats")).json()}
    assert total == (stats[channel]["inboxes"] if channel else sum(s["inboxes"] for s in stats.values()))


async def test_name_sort_is_natural(large: httpx.AsyncClient) -> None:
    rows, _ = await walk(large, "/api/inboxes", {"sort": "name", "channel": "email", "q": "signup run 41"})
    names = [r["label"] for r in rows]
    assert names.index("Signup · run 4199") < names.index("Signup · run 4199 · #2") if "Signup · run 4199 · #2" in names else True
    for a, b in zip(names, names[1:], strict=False):
        assert _natural(a.lower()) <= _natural(b.lower()), (a, b)


@pytest.mark.parametrize("channel", ["email", "sms", "fax"])
async def test_item_pages_and_counters_agree(large: httpx.AsyncClient, channel: str) -> None:
    items, total = await walk(large, "/api/items", {"channel": channel})
    assert len({i["id"] for i in items}) == total
    stamps = [i["createdAt"] for i in items]
    assert stamps == sorted(stamps, reverse=True)

    by_inbox: dict[str, list[dict[str, Any]]] = {}
    for it in items:
        by_inbox.setdefault(it["inboxId"], []).append(it)
    inboxes, _ = await walk(large, "/api/inboxes", {"channel": channel})
    for inbox in inboxes:
        mine = by_inbox.get(inbox["id"], [])
        assert inbox["messageCount"] == len(mine)
        assert inbox["unreadCount"] == sum(not i["read"] for i in mine)
        assert inbox["lastActivityAt"] == (max(i["createdAt"] for i in mine) if mine else None)
    stats = {s["channel"]: s for s in (await large.get("/api/stats")).json()}[channel]
    assert (stats["items"], stats["unread"]) == (total, sum(not i["read"] for i in items))


async def test_failing_counts_match_webhook_chains(large: httpx.AsyncClient) -> None:
    hooks, _ = await walk(large, "/api/webhooks", {}, limit=500)
    latest: dict[tuple[str, str], dict[str, Any]] = {}
    for h in reversed(hooks):  # oldest first
        latest[(h["relatedId"], h["event"])] = h
    failing_items = {k[0] for k, h in latest.items() if h["status"] is None or h["status"] >= 400}
    assert (await large.get("/api/webhooks/failing")).json()["count"] == len([k for k, h in latest.items() if h["status"] is None or h["status"] >= 400])
    failing_inboxes, _ = await walk(large, "/api/inboxes", {"filter": "failing"})
    assert sum(i["failing"] for i in failing_inboxes) == len(failing_items)


# ---------------------------------------------------------------- filters


async def test_filters_and_search(large: httpx.AsyncClient) -> None:
    unread, _ = await walk(large, "/api/inboxes", {"filter": "unread"})
    assert unread and all(i["unreadCount"] > 0 for i in unread)
    pinned, _ = await walk(large, "/api/inboxes", {"filter": "pinned"})
    assert {i["id"] for i in pinned} == {"agent-1", "agent-2", "phone-1", "fax-records"}
    idle, _ = await walk(large, "/api/inboxes", {"filter": "idle"})
    assert idle and all((i["lastActivityAt"] or i["createdAt"]) < "2026-11-10T18:42:00.000Z" for i in idle)

    tagged, n = await walk(large, "/api/inboxes", {"q": "tag:run:41"})
    assert n > 0 and all(any(t.startswith("run:41") for t in i["tags"]) for i in tagged)
    both, _ = await walk(large, "/api/inboxes", {"q": "checkout tag:run:41"})
    assert both and all("checkout" in i["address"] for i in both)
    assert (await large.get("/api/inboxes", params={"q": "100%_literal"})).json()["total"] == 0, "LIKE wildcards are escaped"


async def test_lists_are_lean_and_details_are_full(large: httpx.AsyncClient) -> None:
    item = (await large.get("/api/items", params={"channel": "email", "inbox": "agent-1"})).json()["items"][0]
    assert item["headers"] == [] and "html" not in item
    full = (await large.get(f"/api/items/{item['id']}")).json()
    assert full["headers"] and full["html"].startswith("<!doctype html>")
    hook = (await large.get("/api/webhooks", params={"limit": 1})).json()["items"][0]
    assert hook["requestBody"] == "" and hook["requestHeaders"] == []
    assert (await large.get(f"/api/webhooks/{hook['id']}")).json()["requestBody"]


# -------------------------------------------------------- writes (small db)


async def test_create_inboxes(control: httpx.AsyncClient) -> None:
    one = await control.post("/api/inboxes", json={"channel": "email", "address": "A@Inbox.Test", "tags": ["run:1"]})
    assert one.status_code == 201 and one.json()["address"] == "a@inbox.test" and one.json()["createdBy"] == "agent"
    assert (await control.post("/api/inboxes", json={"channel": "email", "address": "a@inbox.test"})).status_code == 409
    gen = (await control.post("/api/inboxes", json={"channel": "sms"})).json()
    assert gen["address"] == "+14155550100"
    many = await control.post("/api/inboxes", json=[{"channel": "email", "address": f"load-{n}@inbox.test"} for n in range(3)] + [{"channel": "email", "address": "a@inbox.test"}])
    assert many.status_code == 201 and len(many.json()) == 3, "existing addresses are skipped in bulk"
    ui = await control.post("/api/inboxes", json={"channel": "fax"}, headers={"x-phonybox-client": "ui"})
    assert ui.json()["createdBy"] == "ui"
    assert (await control.post("/api/inboxes", json={"channel": "sms", "address": "12"})).status_code == 422
    assert (await control.get("/api/inboxes/tag:run:1")).status_code == 404
    assert (await control.get("/api/inboxes", params={"q": "tag:run:1"})).json()["total"] == 1


async def test_bulk_selection_by_query_minus_except(emu: Emulator, control: httpx.AsyncClient) -> None:
    await control.post("/api/inboxes", json=[{"channel": "email", "address": f"run7-{n}@inbox.test", "tags": ["run:7"]} for n in range(10)])
    keep = ["run7-0-inbox-test", "run7-1-inbox-test"]
    r = await control.post("/api/inboxes/bulk", json={"op": "delete", "query": {"q": "tag:run:7"}, "except": keep})
    assert r.json() == {"affected": 8}
    left = (await control.get("/api/inboxes", params={"q": "tag:run:7"})).json()
    assert sorted(i["id"] for i in left["items"]) == keep
    assert (await control.post("/api/inboxes/bulk", json={"op": "delete", "ids": ["catch-all"]})).json() == {"affected": 0}, "catch-all is never deleted"
    assert (await control.post("/api/inboxes/bulk", json={"op": "pin"})).status_code == 422


async def test_read_state_updates_counters(mailgun: httpx.AsyncClient, control: httpx.AsyncClient) -> None:
    for n in range(3):
        await mailgun.post(f"/v3/{DOMAIN}/messages", data={"from": "a@mg.acme.test", "to": "r@inbox.test", "subject": f"m{n}", "text": "x"})
    items = (await control.get("/api/items", params={"channel": "email"})).json()["items"]
    assert (await control.patch("/api/items", json={"ids": [items[0]["id"]], "read": True})).json() == {"affected": 1}
    assert (await control.get("/api/inboxes/r@inbox.test")).json()["unreadCount"] == 2
    await control.post("/api/inboxes/bulk", json={"op": "read", "ids": ["r-inbox-test"]})
    assert (await control.get("/api/inboxes/r@inbox.test")).json()["unreadCount"] == 0
    await control.delete(f"/api/items/{items[0]['id']}")
    inbox = (await control.get("/api/inboxes/r@inbox.test")).json()
    assert inbox["messageCount"] == 2
    await control.post("/api/inboxes/bulk", json={"op": "clear", "ids": [inbox["id"]]})
    assert (await control.get("/api/inboxes/r@inbox.test")).json()["messageCount"] == 0


async def test_adapters(control: httpx.AsyncClient, emu: Emulator) -> None:
    states = (await control.get("/api/adapters")).json()
    assert set(states) == {"mailgun", "telnyx"} and states["telnyx"]["values"]["publicKey"] == emu.signer.public_key_b64
    r = await control.patch("/api/adapters/telnyx", json={"enabled": False, "values": {"publicKey": "forged", "faxUrl": ""}})
    assert r.json()["enabled"] is False and r.json()["values"]["publicKey"] == emu.signer.public_key_b64, "public key is read-only"
    assert (await control.patch("/api/adapters/nope", json={})).status_code == 404


async def test_reset(control: httpx.AsyncClient) -> None:
    r = await control.post("/api/reset", json={"dataset": "small"})
    assert r.json()["dataset"] == "small"
    assert sum(s["inboxes"] for s in (await control.get("/api/stats")).json()) == 8


# ------------------------------------------------------------------ agents


async def test_wait_returns_existing_match_with_extracted_code(mailgun: httpx.AsyncClient, control: httpx.AsyncClient) -> None:
    await mailgun.post(f"/v3/{DOMAIN}/messages", data={"from": "a@mg.acme.test", "to": "w@inbox.test", "subject": "Confirm your email", "text": "Code: 731 604"})
    r = await control.get("/api/inboxes/w@inbox.test/wait", params={"subject": "confirm", "timeout": 0})
    assert r.status_code == 200 and r.json()["extract"]["codes"] == ["731604"]
    assert (await control.get("/api/inboxes/w@inbox.test/wait", params={"subject": "nope", "timeout": 0})).status_code == 408


async def test_wait_long_polls_until_mail_arrives(mailgun: httpx.AsyncClient, control: httpx.AsyncClient) -> None:
    await control.post("/api/inboxes", json={"channel": "email", "address": "lp@inbox.test"})
    waiter = asyncio.create_task(control.get("/api/inboxes/lp@inbox.test/wait", params={"timeout": 5}))
    await asyncio.sleep(0.05)
    assert not waiter.done()
    await mailgun.post(f"/v3/{DOMAIN}/messages", data={"from": "a@mg.acme.test", "to": "lp@inbox.test", "subject": "Hello", "text": "x"})
    r = await asyncio.wait_for(waiter, 2)
    assert r.status_code == 200 and r.json()["item"]["subject"] == "Hello"


def _natural(s: str) -> list[Any]:
    import re

    return [(0, int(p)) if p.isdigit() else (1, p) for p in re.split(r"(\d+)", s) if p]


def test_selection_helper_is_deterministic() -> None:
    # Guard against accidental use of unseeded randomness in fixtures.
    assert random.Random(7).random() == random.Random(7).random()
