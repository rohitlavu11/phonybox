"""Telnyx Programmable Fax contract: /v2/faxes and fax.* webhooks."""

from __future__ import annotations

import json

import httpx
import pytest

from phonybox.adapters.common import make_pdf, pdf_page_count
from phonybox.clock import parse
from phonybox.emulator import Emulator
from tests.support.contracts import conforms, telnyx_signature_ok
from tests.support.fakes import FakeApp

HOOK = "/webhooks/telnyx/fax"
APP = "+16285550150"
LINE = "+12125550199"
FAX = {"connection_id": "local-fax-app", "from": APP, "to": LINE, "media_url": "http://localhost:3000/files/referral.pdf"}


async def test_send_and_full_lifecycle(emu: Emulator, telnyx: httpx.AsyncClient, control: httpx.AsyncClient, fake_app: FakeApp, golden) -> None:  # type: ignore[no-untyped-def]
    t0 = emu.clock.now()
    r = await telnyx.post("/v2/faxes", json=FAX)
    assert r.status_code == 202
    conforms("telnyx.fax-response", r.json())
    fax_id = r.json()["data"]["id"]
    assert r.json()["data"]["status"] == "queued"

    await emu.run_until_idle()
    reqs = fake_app.to(HOOK)
    events = [json.loads(q.content) for q in reqs]
    assert [e["data"]["event_type"] for e in events] == ["fax.queued", "fax.media.processed", "fax.sending.started", "fax.delivered"]
    assert [(parse(e["data"]["occurred_at"]) - t0).total_seconds() for e in events] == emu.cfg.fax_steps
    for req, e in zip(reqs, events, strict=True):
        conforms("telnyx.event", e)
        conforms("telnyx.fax-event-payload", e["data"]["payload"])
        assert e["data"]["payload"]["fax_id"] == fax_id
        assert telnyx_signature_ok(emu.signer.public_key_b64, req)
    assert events[-1]["data"]["payload"]["page_count"] == 1
    golden("telnyx.fax.delivered.json", events[-1])

    got = (await telnyx.get(f"/v2/faxes/{fax_id}")).json()
    conforms("telnyx.fax-response", got)
    assert got["data"]["status"] == "delivered"
    item = (await control.get("/api/items", params={"channel": "fax"})).json()["items"][0]
    assert item["status"] == "delivered" and [e["event"] for e in item["events"]] == [e["data"]["event_type"] for e in events]


async def test_uploaded_pdf_page_count_flows_through(emu: Emulator, telnyx: httpx.AsyncClient, fake_app: FakeApp) -> None:
    pdf = make_pdf("Referral", 3)
    assert pdf_page_count(pdf) == 3
    data = {k: v for k, v in FAX.items() if k != "media_url"}
    r = await telnyx.post("/v2/faxes", data=data, files={"contents": ("referral.pdf", pdf, "application/pdf")})
    assert r.status_code == 202
    await emu.run_until_idle()
    processed = [e for e in fake_app.json_to(HOOK) if e["data"]["event_type"] == "fax.media.processed"][0]
    assert processed["data"]["payload"]["page_count"] == 3
    media = await telnyx.get(f"/fax-media/{r.json()['data']['id']}.pdf")
    assert media.content == pdf


async def test_busy_line_fails(emu: Emulator, telnyx: httpx.AsyncClient, control: httpx.AsyncClient, fake_app: FakeApp) -> None:
    await control.patch("/api/adapters/telnyx", json={"values": {"failNumbers": LINE}})
    fax_id = (await telnyx.post("/v2/faxes", json=FAX)).json()["data"]["id"]
    await emu.run_until_idle()
    last = fake_app.json_to(HOOK)[-1]["data"]
    assert (last["event_type"], last["payload"]["status"], last["payload"]["failure_reason"]) == ("fax.failed", "failed", "user_busy")
    conforms("telnyx.fax-event-payload", last["payload"])
    assert (await telnyx.get(f"/v2/faxes/{fax_id}")).json()["data"]["status"] == "failed"


@pytest.mark.parametrize(("patch", "pointer"), [({"connection_id": ""}, "/connection_id"), ({"to": "212"}, "/to"), ({"from": "+15555550000"}, "/from"), ({"media_url": ""}, "/media_url")])
async def test_validation(telnyx: httpx.AsyncClient, patch: dict[str, str], pointer: str) -> None:
    r = await telnyx.post("/v2/faxes", json={**FAX, **patch})
    assert r.status_code == 422
    conforms("telnyx.error", r.json())
    assert r.json()["errors"][0]["source"]["pointer"] == pointer


async def test_inbound_fax_received_with_downloadable_media(emu: Emulator, telnyx: httpx.AsyncClient, control: httpx.AsyncClient, fake_app: FakeApp) -> None:
    inbox = (await control.post("/api/inboxes", json={"channel": "fax", "address": LINE})).json()
    r = await control.post(f"/api/inboxes/{inbox['id']}/send", json={"appNumber": APP, "title": "Signed consent", "pages": 2})
    assert r.status_code == 201
    await emu.settle()
    [req] = fake_app.to(HOOK)
    body = json.loads(req.content)
    conforms("telnyx.event", body)
    conforms("telnyx.fax-event-payload", body["data"]["payload"])
    assert telnyx_signature_ok(emu.signer.public_key_b64, req)
    p = body["data"]["payload"]
    assert (body["data"]["event_type"], p["direction"], p["from"], p["to"], p["page_count"]) == ("fax.received", "inbound", LINE, APP, 2)
    media = await telnyx.get(p["media_url"].removeprefix("http://127.0.0.1:4102"))
    assert media.headers["content-type"] == "application/pdf" and pdf_page_count(media.content) == 2


async def test_list_and_delete(emu: Emulator, telnyx: httpx.AsyncClient) -> None:
    ids = [(await telnyx.post("/v2/faxes", json=FAX)).json()["data"]["id"] for _ in range(3)]
    page = (await telnyx.get("/v2/faxes", params={"page[size]": 2})).json()
    conforms("telnyx.fax-list", page)
    assert page["meta"] == {"page_number": 1, "page_size": 2, "total_pages": 2, "total_results": 3}
    assert (await telnyx.delete(f"/v2/faxes/{ids[0]}")).status_code == 204
    assert (await telnyx.get(f"/v2/faxes/{ids[0]}")).status_code == 404
    await emu.run_until_idle()
