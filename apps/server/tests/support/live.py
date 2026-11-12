"""A real Phonybox on ephemeral ports, plus a real HTTP server playing the app under test."""

from __future__ import annotations

import asyncio
import socket
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

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


@contextmanager
def running() -> Iterator[Live]:
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
