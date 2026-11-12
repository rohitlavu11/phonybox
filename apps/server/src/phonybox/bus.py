"""Change feed. Writes publish the topics they touched; the UI's SSE stream and
agents' long-polls subscribe. Topics match the UI's React Query key roots."""

from __future__ import annotations

import asyncio
from typing import Literal

Topic = Literal["inboxes", "items", "webhooks", "requests", "adapters"]
ALL_TOPICS: tuple[Topic, ...] = ("inboxes", "items", "webhooks", "requests", "adapters")


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[frozenset[Topic]]] = set()
        self.version = 0

    def publish(self, *topics: Topic) -> None:
        if not topics:
            return
        self.version += 1
        event = frozenset(topics)
        for q in list(self._subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:  # a stalled client; drop rather than block writers
                pass

    def subscribe(self) -> asyncio.Queue[frozenset[Topic]]:
        q: asyncio.Queue[frozenset[Topic]] = asyncio.Queue(maxsize=256)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[frozenset[Topic]]) -> None:
        self._subscribers.discard(q)
