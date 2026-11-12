"""Real sockets, real clock, and the official provider SDKs.

These are the drift detectors: the deterministic suite proves the emulator
matches the documented contracts; this one proves the SDKs your app actually
ships with still accept the emulator's responses and its webhook signatures.
Nightly runs them twice: with the locked SDK versions, and with the latest.
"""

from __future__ import annotations

import asyncio
import json
import socket
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest

from phonybox.config import Config
from phonybox.emulator import Emulator
from tests.support.db import database


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@dataclass
class Sink:
    """A real HTTP server playing the app under test."""

    port: int
    received: list[tuple[str, dict[str, str], bytes]] = field(default_factory=list)

    def start(self) -> ThreadingHTTPServer:
        sink = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                body = self.rfile.read(int(self.headers.get("content-length", 0)))
                if self.path.startswith("/slow/"):
                    time.sleep(3)  # an app handler stuck in a debugger
                sink.received.append((self.path, {k.lower(): v for k, v in self.headers.items()}, body))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"ok":true}')

            def log_message(self, *args: object) -> None:
                pass

        server = ThreadingHTTPServer(("127.0.0.1", self.port), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return server

    def wait_for(self, path: str, event: str | None = None, timeout: float = 5) -> tuple[dict[str, str], bytes]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for p, headers, body in list(self.received):
                if p == path and (event is None or event.encode() in body):
                    return headers, body
            time.sleep(0.02)
        raise AssertionError(f"no {event or 'request'} at {path} within {timeout}s; got {[p for p, *_ in self.received]}")


@dataclass
class Live:
    emu: Emulator
    sink: Sink

    def url(self, name: str) -> str:
        port = {"control": self.emu.cfg.control_port, "mailgun": self.emu.cfg.mailgun_port, "telnyx": self.emu.cfg.telnyx_port}[name]
        return f"http://127.0.0.1:{port}"


@pytest.fixture(scope="module")
def live() -> Iterator[Live]:
    sink = Sink(free_port())
    server = sink.start()
    cfg = Config(
        dataset="empty", db_path=database(), control_port=free_port(), mailgun_port=free_port(), telnyx_port=free_port(),
        retry_delays=[0.2, 0.5], event_delay=0.05, fax_steps=[0.0, 0.05, 0.1, 0.2],
    )
    emu = Emulator(cfg)
    hook = f"http://127.0.0.1:{sink.port}"
    emu.store.patch_adapter("mailgun", None, {"eventsUrl": f"{hook}/mg/events", "routeUrl": f"{hook}/mg/inbound", "routeMatch": "catch_all()"})
    emu.store.patch_adapter("telnyx", None, {"messagingUrl": f"{hook}/tx/messaging", "faxUrl": f"{hook}/tx/fax"})

    thread = threading.Thread(target=lambda: asyncio.run(emu.serve()), daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not emu.serving:
        assert time.monotonic() < deadline, "emulator did not start"
        time.sleep(0.02)
    yield Live(emu, sink)
    emu.stop()
    thread.join(5)
    server.shutdown()


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
