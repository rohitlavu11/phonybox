"""Time is injected everywhere so tests can freeze and advance it.

Nothing in the emulator calls datetime.now() or sleeps on its own; it asks the
clock. With FrozenClock, webhook retries and fax lifecycles move only when a
test advances time, which is what makes the contract suite deterministic.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...

    def monotonic(self) -> float: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)

    def monotonic(self) -> float:
        return time.perf_counter()


class FrozenClock:
    """Only moves when told to."""

    def __init__(self, start: datetime | str = "2026-11-11T18:42:00Z") -> None:
        self._now = parse(start) if isinstance(start, str) else start
        self._mono = 0.0

    def now(self) -> datetime:
        return self._now

    def monotonic(self) -> float:
        return self._mono

    def advance(self, seconds: float) -> None:
        self._now += timedelta(seconds=seconds)
        self._mono += seconds

    def set(self, when: datetime) -> None:
        self._mono += (when - self._now).total_seconds()
        self._now = when


def iso(dt: datetime) -> str:
    """2026-11-11T18:42:00.000Z: millisecond precision, always UTC, sorts lexically."""
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def unix(dt: datetime) -> int:
    return int(dt.timestamp())
