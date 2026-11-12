"""Real sockets, real clock, and the official provider SDKs.

These are the drift detectors: the deterministic suite proves the emulator
matches the documented contracts; this one proves the SDKs your app actually
ships with still accept the emulator's responses and its webhook signatures.
Nightly runs them twice: with the locked SDK versions, and with the latest.
"""

from __future__ import annotations

import json
import time

import httpx
import pytest

from tests.support.live import Live


def test_sse_streams_change_events(live: Live) -> None:
    with httpx.Client(base_url=live.url("control"), timeout=5) as c, c.stream("GET", "/api/events") as stream:
        lines = stream.iter_lines()
        assert next(lines).startswith("retry:")
        assert next(lines) == "event: hello"
        httpx.post(f"{live.url('control')}/api/inboxes", json={"channel": "email"})
        for line in lines:
            if line.startswith("data:") and "topics" in line:
                assert "inboxes" in json.loads(line[5:])["topics"]
                break


def test_health_and_ui_ports(live: Live) -> None:
    h = httpx.get(f"{live.url('control')}/api/health").json()
    assert h["ok"] and h["ports"]["telnyx"] == live.emu.cfg.telnyx_port


def test_a_hanging_webhook_endpoint_does_not_hold_up_other_deliveries(live: Live) -> None:
    store = live.emu.store
    before = store.adapter_state("telnyx")["values"]["messagingUrl"]
    store.patch_adapter("telnyx", None, {"messagingUrl": f"http://127.0.0.1:{live.sink.port}/slow/messaging"})
    try:
        r = httpx.post(f"{live.url('telnyx')}/v2/messages", headers={"authorization": "Bearer k"}, json={"from": "+16285550100", "to": "+14155550191", "text": "hi"})
        r.raise_for_status()
        time.sleep(0.3)  # message.sent is now stuck in the slow handler
        r = httpx.post(f"{live.url('mailgun')}/v3/mg.acme.test/messages", auth=("api", "k"),
                       data={"from": "noreply@mg.acme.test", "to": "unblocked@inbox.test", "subject": "Hi", "text": "hi"})
        r.raise_for_status()
        live.sink.wait_for("/mg/events", "unblocked@inbox.test", timeout=2)
    finally:
        store.patch_adapter("telnyx", None, {"messagingUrl": before})


@pytest.mark.sdk
def test_telnyx_sdk_messaging_and_webhook_verification(live: Live) -> None:
    from telnyx import Telnyx

    client = Telnyx(api_key="KEY_test", public_key=live.emu.signer.public_key_b64, base_url=f"{live.url('telnyx')}/v2", max_retries=0)
    sent = client.messages.send(from_="+16285550100", to="+14155550190", text="Your code is 731604")
    assert sent.data and sent.data.id and sent.data.to and sent.data.to[0].status == "queued"
    got = client.messages.retrieve(sent.data.id)
    assert got.data and got.data.id == sent.data.id

    headers, body = live.sink.wait_for("/tx/messaging", "message.finalized")
    event = client.webhooks.unwrap(body.decode(), headers=headers)
    assert event.data.event_type == "message.finalized"  # type: ignore[union-attr]
    with pytest.raises(ValueError):
        client.webhooks.unwrap(body.decode().replace("731604", "000000"), headers=headers)


@pytest.mark.sdk
def test_telnyx_sdk_fax(live: Live) -> None:
    from telnyx import Telnyx

    client = Telnyx(api_key="KEY_test", public_key=live.emu.signer.public_key_b64, base_url=f"{live.url('telnyx')}/v2", max_retries=0)
    fax = client.faxes.create(connection_id="local-fax-app", from_="+16285550150", to="+12125550188", media_url="http://example.test/a.pdf")
    assert fax.data and fax.data.status == "queued"
    headers, body = live.sink.wait_for("/tx/fax", "fax.delivered")
    assert client.webhooks.unwrap(body.decode(), headers=headers).data.event_type == "fax.delivered"  # type: ignore[union-attr]
    assert client.faxes.retrieve(fax.data.id).data.status == "delivered"  # type: ignore[union-attr, arg-type]


@pytest.mark.sdk
def test_mailgun_sdk_send_and_events(live: Live) -> None:
    from mailgun.client import Client

    client = Client(auth=("api", "key-test"), api_url=live.url("mailgun"))
    r = client.messages.create(data={"from": "Acme <noreply@mg.acme.test>", "to": "sdk@inbox.test", "subject": "Hi", "text": "code 1234"}, domain="mg.acme.test")
    assert r.status_code == 200 and r.json()["message"] == "Queued. Thank you."
    live.sink.wait_for("/mg/events", '"delivered"')
    events = client.events.get(domain="mg.acme.test")
    assert events.status_code == 200 and any(e["event"] == "delivered" for e in events.json()["items"])
