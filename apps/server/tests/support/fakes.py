"""The app under test, faked, plus the fixed inputs every deterministic test shares."""

from __future__ import annotations

import json
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any

import httpx

#: Frozen-clock start for every deterministic test.
START = "2026-11-11T18:42:00Z"
MG_KEY = "key-test"
TX_KEY = "KEY_test"
DOMAIN = "mg.acme.test"


@dataclass
class FakeApp:
    """Stands in for the app under test. Records every webhook; replies from a per-path script.

    Webhooks reach it through an httpx MockTransport, never a socket.
    """

    received: list[httpx.Request] = field(default_factory=list)
    _script: dict[str, deque[int | Exception]] = field(default_factory=lambda: defaultdict(deque))

    def respond(self, path: str, *outcomes: int | Exception) -> None:
        """Queue responses for a path, e.g. respond("/webhooks/telnyx/messaging", 500, 500, 200)."""
        self._script[path].extend(outcomes)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.received.append(request)
        queue = self._script[request.url.path]
        outcome = queue.popleft() if queue else 200
        if isinstance(outcome, Exception):
            raise outcome
        return httpx.Response(outcome, json={"ok": outcome < 400})

    def to(self, path: str) -> list[httpx.Request]:
        return [r for r in self.received if r.url.path == path]

    def json_to(self, path: str) -> list[dict[str, Any]]:
        return [json.loads(r.content) for r in self.to(path)]
