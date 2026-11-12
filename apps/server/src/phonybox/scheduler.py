"""Time-driven work: webhook delivery attempts, retries and fax lifecycles.

Jobs are kept in a heap keyed by the clock. Tests call `run_due()` after
advancing a FrozenClock: it runs due jobs one at a time, so the order of side
effects depends only on the clock and insertion order. The server calls
`start_due()` instead, which runs each due job as its own task, so an app whose
webhook endpoint hangs can't hold up deliveries to everyone else.
"""

from __future__ import annotations

import asyncio
import heapq
import itertools
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

import httpx

from .clock import Clock, iso
from .config import Config
from .ids import Ids
from .store import Store

Job = Callable[[], Awaitable[None]]
log = logging.getLogger("phonybox.scheduler")


@dataclass(order=True)
class _Entry:
    at: datetime
    seq: int
    job: Job = field(compare=False)


class Scheduler:
    def __init__(self, clock: Clock) -> None:
        self.clock = clock
        self._heap: list[_Entry] = []
        self._seq = itertools.count()
        self._running: set[asyncio.Task[None]] = set()

    def at(self, when: datetime, job: Job) -> None:
        heapq.heappush(self._heap, _Entry(when, next(self._seq), job))

    def after(self, seconds: float, job: Job) -> None:
        self.at(self.clock.now() + timedelta(seconds=seconds), job)

    def next_due(self) -> datetime | None:
        return self._heap[0].at if self._heap else None

    def pending(self) -> int:
        """Jobs waiting for their time, plus jobs started by start_due() that haven't finished."""
        return len(self._heap) + len(self._running)

    async def run_due(self) -> int:
        """Run every job due now, one at a time, including ones scheduled by jobs that just ran."""
        ran = 0
        while self._heap and self._heap[0].at <= self.clock.now():
            entry = heapq.heappop(self._heap)
            await entry.job()
            ran += 1
        return ran

    def start_due(self) -> int:
        """Start every job due now as its own task, without waiting for any of them."""
        started = 0
        while self._heap and self._heap[0].at <= self.clock.now():
            task = asyncio.create_task(heapq.heappop(self._heap).job())
            self._running.add(task)
            task.add_done_callback(self._finished)
            started += 1
        return started

    def _finished(self, task: asyncio.Task[None]) -> None:
        self._running.discard(task)
        if not task.cancelled() and (exc := task.exception()):
            log.error("scheduled job failed", exc_info=exc)

    def cancel(self) -> None:
        """Drop pending jobs and cancel running ones (used by reset)."""
        self._heap.clear()
        for task in list(self._running):
            task.cancel()


#: Builds the request for one attempt: (attempt, at) -> (headers, body bytes). Same as adapters.base.BuildAttempt.
BuildRequest = Callable[[int, datetime], tuple[list[tuple[str, str]], bytes]]


class Deliverer:
    """Sends webhooks to the app under test and records every attempt."""

    def __init__(self, cfg: Config, clock: Clock, ids: Ids, store: Store, scheduler: Scheduler, http: httpx.AsyncClient) -> None:
        self.cfg = cfg
        self.clock = clock
        self.ids = ids
        self.store = store
        self.scheduler = scheduler
        self.http = http

    def enqueue(
        self,
        *,
        adapter_id: str,
        channel: str,
        event: str,
        url: str,
        related_id: str | None,
        build: BuildRequest,
        failover_url: str | None = None,
        delay: float = 0.0,
        on_done: Callable[[bool], Awaitable[None]] | None = None,
    ) -> bool:
        """Schedule delivery. Returns False (and records nothing) when no URL is configured,
        which is what a provider does when you haven't set a webhook."""
        if not url:
            return False

        async def attempt(n: int) -> None:
            ok = await self._send(adapter_id, channel, event, url, related_id, build, n)
            if not ok and failover_url:
                ok = await self._send(adapter_id, channel, event, failover_url, related_id, build, n)
            if ok or n >= self.cfg.max_attempts:
                if on_done:
                    await on_done(ok)
                return
            self.scheduler.after(self.cfg.retry_delays[n - 1], lambda: attempt(n + 1))

        self.scheduler.after(delay, lambda: attempt(1))
        return True

    async def _send(self, adapter_id: str, channel: str, event: str, url: str, related_id: str | None, build: BuildRequest, attempt: int) -> bool:
        at = self.clock.now()
        headers, body = build(attempt, at)
        status: int | None = None
        response: str | None = None
        error: str | None = None
        t0 = self.clock.monotonic()
        try:
            resp = await self.http.post(url, content=body, headers=headers, timeout=self.cfg.webhook_timeout)
            status = resp.status_code
            response = resp.text[:16_384]
        except httpx.TimeoutException:
            error = f"timed out after {self.cfg.webhook_timeout:g}s"
        except httpx.TransportError as e:
            error = f"{type(e).__name__}: {e}"
        duration = int(round((self.clock.monotonic() - t0) * 1000))
        record: dict[str, Any] = {
            "id": self.ids.short("wh"),
            "adapterId": adapter_id,
            "channel": channel,
            "event": event,
            "url": url,
            "status": status,
            "durationMs": duration,
            "attempt": attempt,
            "maxAttempts": self.cfg.max_attempts,
            "createdAt": iso(at),
            "requestHeaders": headers,
            "requestBody": body.decode("utf-8", errors="replace"),
        }
        if related_id:
            record["relatedId"] = related_id
        if response is not None:
            record["responseBody"] = response
        if error:
            record["error"] = error
        self.store.add_webhook(record)
        return status is not None and 200 <= status < 300

    async def replay(self, webhook_id: str) -> dict[str, Any] | None:
        """Re-send the exact recorded request once (no retries), like a dashboard replay."""
        w = self.store.get_webhook(webhook_id)
        if not w:
            return None
        body = w["requestBody"].encode()
        headers = [tuple(h) for h in w["requestHeaders"]]
        await self._send(w["adapterId"], w["channel"], w["event"], w["url"], w.get("relatedId"), lambda _n, _at: (headers, body), 1)  # type: ignore[arg-type]
        return self.store.latest_webhook()
