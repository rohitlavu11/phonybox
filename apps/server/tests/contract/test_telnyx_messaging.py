"""Telnyx Messaging contract: POST/GET /v2/messages and message.* webhooks."""

from __future__ import annotations

import json

import httpx
import pytest

from phonybox.emulator import Emulator
from tests.support.contracts import conforms, telnyx_signature_ok
from tests.support.fakes import FakeApp

HOOK = "/webhooks/telnyx/messaging"
APP = "+16285550100"
PHONE = "+14155550142"


async def send(telnyx: httpx.AsyncClient, **body: object) -> httpx.Response:
    return await telnyx.post("/v2/messages", json={"from": APP, "to": PHONE, "text": "Your Acme code is 731604", **body})


async def test_send_returns_telnyx_shape_and_lands_in_inbox(telnyx: httpx.AsyncClient, control: httpx.AsyncClient) -> None:
    r = await send(telnyx)
    assert r.status_code == 200
    conforms("telnyx.message-response", r.json())
    data = r.json()["data"]
    assert (data["direction"], data["type"], data["to"][0]["status"], data["encoding"], data["parts"]) == ("outbound", "SMS", "queued", "GSM-7", 1)

    inbox = (await control.get(f"/api/inboxes/{PHONE}")).json()
    assert (inbox["channel"], inbox["createdBy"], inbox["unreadCount"]) == ("sms", "auto", 1)
    [conv] = (await control.get("/api/sms/conversations", params={"inbox": inbox["id"]})).json()["items"]
    assert (conv["appNumber"], conv["last"]["providerId"], conv["last"]["body"]) == (APP, data["id"], "Your Acme code is 731604")


@pytest.mark.parametrize(
    ("text", "encoding", "parts"),
    [("a" * 160, "GSM-7", 1), ("a" * 161, "GSM-7", 2), ("{" * 80, "GSM-7", 1), ("{" * 81, "GSM-7", 2), ("é" * 160, "GSM-7", 1), ("✓" * 70, "UCS-2", 1), ("✓" * 71, "UCS-2", 2)],
)
async def test_encoding_and_segments(telnyx: httpx.AsyncClient, text: str, encoding: str, parts: int) -> None:
    data = (await send(telnyx, text=text)).json()["data"]
    assert (data["encoding"], data["parts"]) == (encoding, parts)


async def test_lifecycle_webhooks_are_ordered_signed_and_reflected_by_get(emu: Emulator, telnyx: httpx.AsyncClient, fake_app: FakeApp, golden) -> None:  # type: ignore[no-untyped-def]
    msg_id = (await send(telnyx)).json()["data"]["id"]
    await emu.advance(emu.cfg.event_delay)
    assert (await telnyx.get(f"/v2/messages/{msg_id}")).json()["data"]["to"][0]["status"] == "sent"
    await emu.advance(emu.cfg.event_delay)
    got = (await telnyx.get(f"/v2/messages/{msg_id}")).json()
    conforms("telnyx.message-response", got)
    assert got["data"]["to"][0]["status"] == "delivered"

    reqs = fake_app.to(HOOK)
    assert [json.loads(r.content)["data"]["event_type"] for r in reqs] == ["message.sent", "message.finalized"]
    for req in reqs:
        body = json.loads(req.content)
        conforms("telnyx.event", body)
        conforms("telnyx.message", body["data"]["payload"])
        assert body["data"]["payload"]["id"] == msg_id
        assert telnyx_signature_ok(emu.signer.public_key_b64, req)
        assert req.headers["telnyx-timestamp"] == str(int(emu.clock.now().timestamp() - (emu.cfg.event_delay if req is reqs[0] else 0)))
    final = json.loads(reqs[1].content)["data"]["payload"]
    assert final["to"][0]["status"] == "delivered" and final["completed_at"] is not None
    golden("telnyx.message.finalized.json", json.loads(reqs[1].content))


async def test_signature_rejects_tampering(emu: Emulator, telnyx: httpx.AsyncClient, fake_app: FakeApp) -> None:
    await send(telnyx)
    await emu.advance(1)
    req = fake_app.to(HOOK)[0]
    forged = httpx.Request("POST", req.url, headers=req.headers, content=req.content.replace(b"731604", b"000000"))
    assert telnyx_signature_ok(emu.signer.public_key_b64, req)
    assert not telnyx_signature_ok(emu.signer.public_key_b64, forged)


@pytest.mark.parametrize(
    ("body", "status", "code", "pointer"),
    [
        ({"to": "4155550142"}, 422, "40310", "/to"),
        ({"from": "+15555550000"}, 422, "40305", "/from"),
        ({"from": ""}, 422, "40305", "/from"),
        ({"text": ""}, 422, "40005", "/text"),
    ],
)
async def test_validation_errors(telnyx: httpx.AsyncClient, body: dict[str, str], status: int, code: str, pointer: str) -> None:
    r = await send(telnyx, **body)
    assert r.status_code == status
    conforms("telnyx.error", r.json())
    err = r.json()["errors"][0]
    assert (err["code"], err["source"]["pointer"]) == (code, pointer)


async def test_auth_and_not_found(emu: Emulator, telnyx: httpx.AsyncClient) -> None:
    anon = httpx.AsyncClient(transport=httpx.ASGITransport(app=emu.telnyx), base_url="http://127.0.0.1:4102")
    r = await anon.post("/v2/messages", json={"from": APP, "to": PHONE, "text": "x"})
    assert r.status_code == 401 and r.json()["errors"][0]["code"] == "10009"
    conforms("telnyx.error", r.json())
    r = await telnyx.get("/v2/messages/00000000-0000-4000-8000-000000000000")
    assert r.status_code == 404 and r.json()["errors"][0]["code"] == "10005"


async def test_inbound_text_is_message_received(emu: Emulator, control: httpx.AsyncClient, fake_app: FakeApp, golden) -> None:  # type: ignore[no-untyped-def]
    inbox = (await control.post("/api/inboxes", json={"channel": "sms", "address": PHONE, "label": "Agent 1"})).json()
    r = await control.post(f"/api/inboxes/{inbox['id']}/send", json={"appNumber": APP, "body": "C"})
    assert r.status_code == 201
    await emu.settle()
    [req] = fake_app.to(HOOK)
    body = json.loads(req.content)
    conforms("telnyx.event", body)
    conforms("telnyx.message", body["data"]["payload"])
    p = body["data"]["payload"]
    assert (body["data"]["event_type"], p["direction"], p["from"]["phone_number"], p["to"][0]["phone_number"], p["text"]) == ("message.received", "inbound", PHONE, APP, "C")
    assert telnyx_signature_ok(emu.signer.public_key_b64, req)
    golden("telnyx.message.received.json", body)


async def test_stop_opts_out_and_start_opts_back_in(emu: Emulator, telnyx: httpx.AsyncClient, control: httpx.AsyncClient, fake_app: FakeApp) -> None:
    inbox = (await control.post("/api/inboxes", json={"channel": "sms", "address": PHONE})).json()
    await control.post(f"/api/inboxes/{inbox['id']}/send", json={"appNumber": APP, "body": " Stop "})
    thread = (await control.get(f"/api/sms/conversations/{inbox['id']}/{APP}")).json()
    assert [(m["direction"], m["body"][:20]) for m in thread] == [("inbound", " Stop "), ("outbound", "You have successfull")]

    blocked = await send(telnyx)
    await emu.run_until_idle()
    final = [b for b in fake_app.json_to(HOOK) if b["data"]["event_type"] == "message.finalized"][-1]["data"]["payload"]
    assert final["to"][0]["status"] == "delivery_failed" and final["errors"][0]["code"] == "40300"
    # Polling apps see the same outcome as webhook apps.
    got = (await telnyx.get(f"/v2/messages/{blocked.json()['data']['id']}")).json()["data"]
    conforms("telnyx.message", got)
    assert (got["to"][0]["status"], got["errors"], got["sent_at"], got["completed_at"]) == (final["to"][0]["status"], final["errors"], final["sent_at"], final["completed_at"])

    await control.post(f"/api/inboxes/{inbox['id']}/send", json={"appNumber": APP, "body": "START"})
    await send(telnyx)
    await emu.run_until_idle()
    final = [b for b in fake_app.json_to(HOOK) if b["data"]["event_type"] == "message.finalized"][-1]["data"]["payload"]
    assert final["to"][0]["status"] == "delivered" and final["errors"] == []


async def test_failover_url_gets_the_same_attempt(emu: Emulator, telnyx: httpx.AsyncClient, control: httpx.AsyncClient, fake_app: FakeApp) -> None:
    await control.patch("/api/adapters/telnyx", json={"values": {"messagingFailoverUrl": "http://localhost:3001/failover"}})
    fake_app.respond(HOOK, 500)
    await send(telnyx)
    await emu.advance(emu.cfg.event_delay)
    assert len(fake_app.to(HOOK)) == 1 and len(fake_app.to("/failover")) == 1
    hooks = (await control.get("/api/webhooks")).json()["items"]
    assert [(h["url"], h["status"], h["attempt"]) for h in hooks] == [("http://localhost:3001/failover", 200, 1), ("http://localhost:3000/webhooks/telnyx/messaging", 500, 1)]


async def test_per_message_webhook_url_overrides_profile(emu: Emulator, telnyx: httpx.AsyncClient, fake_app: FakeApp) -> None:
    await send(telnyx, webhook_url="http://localhost:4000/hooks/sms")
    await emu.run_until_idle()
    assert fake_app.to(HOOK) == [] and len(fake_app.to("/hooks/sms")) == 2


async def test_fail_numbers_fault_rule(emu: Emulator, telnyx: httpx.AsyncClient, control: httpx.AsyncClient, fake_app: FakeApp) -> None:
    await control.patch("/api/adapters/telnyx", json={"values": {"failNumbers": PHONE}})
    await send(telnyx)
    await emu.run_until_idle()
    final = fake_app.json_to(HOOK)[-1]["data"]["payload"]
    assert final["to"][0]["status"] == "delivery_failed" and final["errors"][0]["code"] == "40008"
    item = (await control.get("/api/items", params={"channel": "sms"})).json()["items"][0]
    assert item["status"] == "failed"


async def test_profiles_and_numbers(telnyx: httpx.AsyncClient) -> None:
    profiles = (await telnyx.get("/v2/messaging_profiles")).json()
    assert profiles["data"][0]["record_type"] == "messaging_profile" and profiles["meta"]["total_results"] == 1
    numbers = (await telnyx.get("/v2/phone_numbers")).json()["data"]
    assert [n["phone_number"] for n in numbers] == ["+16285550100", "+16285550111", "+16285550150"]
