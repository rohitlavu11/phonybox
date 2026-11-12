"""Mailgun contract: the API your app calls, and the webhooks your app receives."""

from __future__ import annotations

import json

import httpx
import pytest

from phonybox.emulator import Emulator
from tests.support.contracts import conforms, form_fields, mailgun_signature_ok
from tests.support.fakes import DOMAIN, FakeApp

EVENTS = "/webhooks/mailgun/events"
ROUTE = "/webhooks/mailgun/inbound"
SIGNING_KEY = "whsk-local-mg-3f9a21"


async def send(mailgun: httpx.AsyncClient, **fields: object) -> httpx.Response:
    data = {"from": "Acme <noreply@mg.acme.test>", "to": "riley@inbox.test", "subject": "Confirm your email", "text": "Your code is 482913", **fields}
    return await mailgun.post(f"/v3/{DOMAIN}/messages", data=data)


# ---------------------------------------------------------------- sending


async def test_send_returns_mailgun_shape_and_lands_in_inbox(mailgun: httpx.AsyncClient, control: httpx.AsyncClient) -> None:
    r = await send(mailgun, **{"o:tag": ["verify", "signup"], "h:X-Request-Id": "abc", "v:user_id": "42"})
    assert r.status_code == 200
    conforms("mailgun.send-response", r.json())

    inbox = (await control.get("/api/inboxes/riley@inbox.test")).json()
    assert inbox["createdBy"] == "auto" and inbox["messageCount"] == 1 and inbox["unreadCount"] == 1

    item = (await control.get("/api/items", params={"channel": "email", "inbox": inbox["id"]})).json()["items"][0]
    assert item["messageId"] == r.json()["id"]
    assert item["direction"] == "outbound" and item["status"] == "delivered"
    assert item["tags"] == ["verify", "signup"] and item["headers"] == [] and "html" not in item

    full = (await control.get(f"/api/items/{item['id']}")).json()
    headers = dict(full["headers"])
    assert headers["X-Request-Id"] == "abc" and json.loads(headers["X-Mailgun-Variables"]) == {"user_id": "42"}
    assert (await control.get(f"/api/items/{item['id']}/extract")).json() == {"codes": ["482913"], "links": []}


async def test_every_recipient_gets_a_copy_with_one_message_id(mailgun: httpx.AsyncClient, control: httpx.AsyncClient) -> None:
    r = await send(mailgun, to=["a@inbox.test", "B <b@inbox.test>"], cc="c@inbox.test", bcc="a@inbox.test")
    assert r.status_code == 200
    items = (await control.get("/api/items", params={"channel": "email"})).json()
    assert items["total"] == 3
    assert {i["to"][0]["address"] for i in items["items"]} == {"a@inbox.test", "b@inbox.test", "c@inbox.test"}
    assert {i["messageId"] for i in items["items"]} == {r.json()["id"]}


async def test_attachments_are_stored_and_downloadable(mailgun: httpx.AsyncClient, control: httpx.AsyncClient) -> None:
    files = [("attachment", ("INV-1.pdf", b"%PDF-1.4 test", "application/pdf"))]
    r = await mailgun.post(f"/v3/{DOMAIN}/messages", data={"from": "a@mg.acme.test", "to": "x@inbox.test", "subject": "Invoice", "text": "attached"}, files=files)
    assert r.status_code == 200
    item = (await control.get("/api/items", params={"channel": "email"})).json()["items"][0]
    assert item["attachments"] == [{"filename": "INV-1.pdf", "contentType": "application/pdf", "size": 13}]
    blob = await control.get(f"/api/items/{item['id']}/attachments/0")
    assert blob.status_code == 200 and blob.content == b"%PDF-1.4 test"


async def test_html_only_mail_gets_a_text_part(mailgun: httpx.AsyncClient, control: httpx.AsyncClient) -> None:
    await send(mailgun, text="", html="<h1>Hi</h1><p>Code: 1234</p>")
    item = (await control.get("/api/items", params={"channel": "email"})).json()["items"][0]
    assert item["text"] == "Hi\nCode: 1234"
    assert (await control.get(f"/api/items/{item['id']}")).json()["html"] == "<h1>Hi</h1><p>Code: 1234</p>"


async def test_mime_send(mailgun: httpx.AsyncClient, control: httpx.AsyncClient) -> None:
    mime = b"From: Acme <noreply@mg.acme.test>\r\nTo: m@inbox.test\r\nSubject: Raw\r\nContent-Type: text/plain\r\n\r\nraw body\r\n"
    r = await mailgun.post(f"/v3/{DOMAIN}/messages.mime", data={"to": "m@inbox.test"}, files={"message": ("m.eml", mime, "message/rfc822")})
    assert r.status_code == 200
    conforms("mailgun.send-response", r.json())
    item = (await control.get("/api/items", params={"channel": "email"})).json()["items"][0]
    assert (item["subject"], item["text"].strip()) == ("Raw", "raw body")


@pytest.mark.parametrize(
    ("fields", "status", "message"),
    [
        ({"from": ""}, 400, "from parameter is missing"),
        ({"to": ""}, 400, "to parameter is missing"),
        ({"to": "not-an-address"}, 400, "to parameter is not a valid address. please check documentation"),
        ({"text": ""}, 400, "Need at least one of 'text', 'html' or 'template' parameters specified"),
    ],
)
async def test_validation_errors(mailgun: httpx.AsyncClient, fields: dict[str, str], status: int, message: str) -> None:
    r = await send(mailgun, **fields)
    assert (r.status_code, r.json()) == (status, {"message": message})
    conforms("mailgun.error", r.json())


async def test_unknown_domain_is_404(mailgun: httpx.AsyncClient) -> None:
    r = await mailgun.post("/v3/acme.test/messages", data={"from": "a@x.test", "to": "b@inbox.test", "text": "x"})
    assert (r.status_code, r.json()) == (404, {"message": "Domain not found: acme.test"})


async def test_auth(emu: Emulator, mailgun: httpx.AsyncClient) -> None:
    anon = httpx.AsyncClient(transport=httpx.ASGITransport(app=emu.mailgun), base_url="http://127.0.0.1:4101")
    r = await anon.post(f"/v3/{DOMAIN}/messages", data={"from": "a@x.test", "to": "b@inbox.test", "text": "x"})
    assert (r.status_code, r.text) == (401, "Forbidden")

    emu.store.patch_adapter("mailgun", None, {"acceptAnyKey": False, "apiKey": "key-right"})
    assert (await send(mailgun)).status_code == 401
    right = httpx.AsyncClient(transport=httpx.ASGITransport(app=emu.mailgun), base_url="http://127.0.0.1:4101", auth=("api", "key-right"))
    assert (await send(right)).status_code == 200


async def test_disabled_adapter_is_503(emu: Emulator, mailgun: httpx.AsyncClient) -> None:
    emu.store.patch_adapter("mailgun", False, None)
    r = await send(mailgun)
    assert r.status_code == 503
    conforms("mailgun.error", r.json())


async def test_unemulated_endpoint_is_404_json(mailgun: httpx.AsyncClient) -> None:
    r = await mailgun.get("/v3/lists")
    assert r.status_code == 404
    conforms("mailgun.error", r.json())


async def test_calls_are_recorded_in_the_api_log(mailgun: httpx.AsyncClient, control: httpx.AsyncClient) -> None:
    r = await send(mailgun, subject="Logged")
    log = (await control.get("/api/requests")).json()["items"]
    assert [(e["method"], e["path"], e["status"]) for e in log] == [("POST", f"/v3/{DOMAIN}/messages", 200)]
    entry = (await control.get(f"/api/requests/{log[0]['id']}")).json()
    assert "subject=Logged" in entry["requestBody"] and json.loads(entry["responseBody"]) == r.json()
    item = (await control.get(f"/api/items/{entry['relatedId']}")).json()
    assert item["subject"] == "Logged"


# ------------------------------------------------------------ other APIs


async def test_events_api(emu: Emulator, mailgun: httpx.AsyncClient) -> None:
    await send(mailgun)
    r = await mailgun.get(f"/v3/{DOMAIN}/events", params={"ascending": "yes"})
    conforms("mailgun.events-list", r.json())
    assert [e["event"] for e in r.json()["items"]] == ["accepted"]

    await emu.advance(1)
    r = await mailgun.get(f"/v3/{DOMAIN}/events", params={"event": "delivered"})
    conforms("mailgun.events-list", r.json())
    assert [(e["event"], e["recipient"]) for e in r.json()["items"]] == [("delivered", "riley@inbox.test")]

    nxt = r.json()["paging"]["next"].removeprefix("http://127.0.0.1:4101")
    assert (await mailgun.get(nxt, params={"event": "delivered"})).json()["items"] == []


async def test_domain_and_routes(mailgun: httpx.AsyncClient) -> None:
    conforms("mailgun.domain", (await mailgun.get(f"/v3/domains/{DOMAIN}")).json())
    r = await mailgun.post("/v3/routes", data={"priority": "1", "expression": 'match_recipient("help@.*")', "action": ['forward("http://localhost:3000/help")', "stop()"]})
    assert r.status_code == 200 and r.json()["message"] == "Route has been created"
    listed = (await mailgun.get("/v3/routes")).json()
    assert listed["total_count"] == 1 and listed["items"][0]["actions"] == ['forward("http://localhost:3000/help")', "stop()"]


# --------------------------------------------------------------- webhooks


async def test_delivered_webhook(emu: Emulator, mailgun: httpx.AsyncClient, fake_app: FakeApp, golden) -> None:  # type: ignore[no-untyped-def]
    await send(mailgun)
    await emu.settle()
    assert fake_app.to(EVENTS) == [], "events are sent after event_delay, not inline"

    await emu.advance(emu.cfg.event_delay)
    [req] = fake_app.to(EVENTS)
    body = json.loads(req.content)
    assert req.headers["content-type"] == "application/json"
    conforms("mailgun.event-webhook", body)
    assert mailgun_signature_ok(SIGNING_KEY, body["signature"])
    assert body["event-data"]["event"] == "delivered" and body["event-data"]["delivery-status"]["code"] == 250
    golden("mailgun.delivered.json", body)


async def test_bounce_rule_sends_permanent_fail(emu: Emulator, mailgun: httpx.AsyncClient, control: httpx.AsyncClient, fake_app: FakeApp) -> None:
    await send(mailgun, to="bounce@inbox.test")
    await emu.advance(1)
    [body] = fake_app.json_to(EVENTS)
    conforms("mailgun.event-webhook", body)
    ed = body["event-data"]
    assert (ed["event"], ed["severity"], ed["reason"], ed["delivery-status"]["code"]) == ("failed", "permanent", "bounce", 550)

    item = (await control.get("/api/items", params={"channel": "email"})).json()["items"][0]
    assert item["status"] == "bounced"
    bounces = (await mailgun.get(f"/v3/{DOMAIN}/bounces")).json()["items"]
    assert [b["address"] for b in bounces] == ["bounce@inbox.test"] and bounces[0]["code"] == "550"


async def test_route_forward_on_inbound_mail(emu: Emulator, control: httpx.AsyncClient, fake_app: FakeApp, golden) -> None:  # type: ignore[no-untyped-def]
    inbox = (await control.post("/api/inboxes", json={"channel": "email", "address": "qa@inbox.test", "label": "QA"})).json()
    r = await control.post(f"/api/inboxes/{inbox['id']}/send", json={"to": "support@mg.acme.test", "subject": "Re: Reset", "text": "Link expired.\n\nOn Tue, Acme wrote:\n> old"})
    assert r.status_code == 201 and r.json()["direction"] == "inbound"

    await emu.settle()
    [req] = fake_app.to(ROUTE)
    fields = form_fields(req)
    conforms("mailgun.route-forward", fields)
    assert mailgun_signature_ok(SIGNING_KEY, fields)
    assert (fields["recipient"], fields["sender"], fields["subject"]) == ("support@mg.acme.test", "qa@inbox.test", "Re: Reset")
    assert fields["stripped-text"] == "Link expired."
    golden("mailgun.route-forward.txt", req.content.decode())


async def test_routes_created_through_the_api_also_forward(emu: Emulator, mailgun: httpx.AsyncClient, control: httpx.AsyncClient, fake_app: FakeApp) -> None:
    await mailgun.post("/v3/routes", data={"expression": 'match_recipient("help@mg.acme.test")', "action": 'forward("http://localhost:3000/help")'})
    inbox = (await control.post("/api/inboxes", json={"channel": "email"})).json()
    await control.post(f"/api/inboxes/{inbox['id']}/send", json={"to": "help@mg.acme.test", "subject": "Hi", "text": "x"})
    await emu.settle()
    assert len(fake_app.to(ROUTE)) == 1 and len(fake_app.to("/help")) == 1


async def test_mail_to_an_address_without_a_route_is_not_forwarded(emu: Emulator, control: httpx.AsyncClient, fake_app: FakeApp) -> None:
    inbox = (await control.post("/api/inboxes", json={"channel": "email"})).json()
    await control.post(f"/api/inboxes/{inbox['id']}/send", json={"to": "someone@elsewhere.test", "subject": "Hi", "text": "x"})
    await emu.run_until_idle()
    assert fake_app.received == []


async def test_retries_follow_the_schedule_and_clear_failing(emu: Emulator, mailgun: httpx.AsyncClient, control: httpx.AsyncClient, fake_app: FakeApp) -> None:
    fake_app.respond(EVENTS, 500, 503, 200)
    await send(mailgun)
    t0 = emu.clock.now()
    await emu.advance(emu.cfg.event_delay)
    assert len(fake_app.to(EVENTS)) == 1
    assert (await control.get("/api/webhooks/failing")).json() == {"count": 1}
    inbox = (await control.get("/api/inboxes/riley@inbox.test")).json()
    assert inbox["failing"] == 1

    await emu.run_until_idle()
    hooks = (await control.get("/api/webhooks")).json()["items"][::-1]
    assert [(h["attempt"], h["status"]) for h in hooks] == [(1, 500), (2, 503), (3, 200)]
    offsets = [(_parse(h["createdAt"]) - t0).total_seconds() for h in hooks]
    d = emu.cfg.event_delay
    assert offsets == [d, d + emu.cfg.retry_delays[0], d + sum(emu.cfg.retry_delays)]
    assert (await control.get("/api/webhooks/failing")).json() == {"count": 0}
    assert (await control.get("/api/inboxes/riley@inbox.test")).json()["failing"] == 0


async def test_connection_refused_is_recorded_and_replay_recovers(emu: Emulator, mailgun: httpx.AsyncClient, control: httpx.AsyncClient, fake_app: FakeApp) -> None:
    refused = httpx.ConnectError("connect ECONNREFUSED 127.0.0.1:3000")
    fake_app.respond(EVENTS, refused, refused, refused)
    await send(mailgun)
    await emu.run_until_idle()
    hooks = (await control.get("/api/webhooks")).json()["items"]
    assert [(h["status"], h["error"]) for h in hooks] == [(None, "ConnectError: connect ECONNREFUSED 127.0.0.1:3000")] * 3
    assert (await control.get("/api/webhooks/failing")).json() == {"count": 1}

    replayed = (await control.post(f"/api/webhooks/{hooks[0]['id']}/replay")).json()
    assert replayed["status"] == 200 and replayed["attempt"] == 1
    original = (await control.get(f"/api/webhooks/{hooks[0]['id']}")).json()
    assert fake_app.to(EVENTS)[-1].content.decode() == original["requestBody"], "replay re-sends the recorded bytes"
    assert (await control.get("/api/webhooks/failing")).json() == {"count": 0}


async def test_no_url_means_no_delivery(emu: Emulator, mailgun: httpx.AsyncClient, control: httpx.AsyncClient, fake_app: FakeApp) -> None:
    emu.store.patch_adapter("mailgun", None, {"eventsUrl": ""})
    await send(mailgun)
    await emu.run_until_idle()
    assert fake_app.received == [] and (await control.get("/api/webhooks")).json()["total"] == 0


def _parse(iso: str):  # type: ignore[no-untyped-def]
    from phonybox.clock import parse

    return parse(iso)
