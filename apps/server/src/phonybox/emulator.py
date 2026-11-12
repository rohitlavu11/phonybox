"""Composition root.

    emu = Emulator(Config())          # real clock, random ids, real HTTP
    await emu.serve()                  # control :4100, mailgun :4101, telnyx :4102

For tests, inject a FrozenClock, seeded Ids and an httpx transport that routes
webhooks to an in-process fake app, then drive time with `advance()`.
"""

from __future__ import annotations

import asyncio
import contextlib
import re
import signal
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI

from . import adapters, seed
from .bus import EventBus
from .clock import Clock, FrozenClock, SystemClock, iso
from .config import Config, Dataset
from .control import build_control_app
from .db import connect
from .ids import Ids
from .scheduler import Deliverer, Scheduler
from .signing import TelnyxSigner
from .store import Store

PHONE_AREAS = ("415", "628", "650", "510", "408", "212", "646", "718", "312", "617", "206", "303")


class Emulator:
    def __init__(
        self,
        cfg: Config | None = None,
        *,
        clock: Clock | None = None,
        ids: Ids | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.cfg = cfg or Config()
        self.clock: Clock = clock or SystemClock()
        self.ids = ids or Ids()
        self.bus = EventBus()
        self.store = Store(connect(self.cfg.db_path), self.clock, self.bus)
        self.scheduler = Scheduler(self.clock)
        self.http = httpx.AsyncClient(transport=transport, follow_redirects=False)
        self.deliverer = Deliverer(self.cfg, self.clock, self.ids, self.store, self.scheduler, self.http)
        self.signer = TelnyxSigner(self.cfg.telnyx_key_seed)
        self.started_at = self.clock.now()
        self.dataset: Dataset = self.cfg.dataset
        if not self.store.adapter_states():  # fresh database
            self.reset(self.cfg.dataset)

        self.control = build_control_app(self)
        #: One FastAPI app per registered adapter, each on its own port.
        self.adapter_apps: dict[str, FastAPI] = {spec.id: spec.build_app(self) for spec in adapters.REGISTRY.values()}

    # ------------------------------------------------------------- state

    def reset(self, dataset: Dataset | None = None) -> None:
        self.dataset = dataset or self.dataset
        if old := getattr(self, "scheduler", None):
            old.cancel()
        self.scheduler = Scheduler(self.clock)
        self.deliverer.scheduler = self.scheduler
        seed.load(self, self.dataset)

    def inbox_id(self, channel: str, address: str) -> str:
        if channel == "email":
            return re.sub(r"[^a-z0-9]+", "-", address.lower()).strip("-")
        return f"{'n' if channel == 'sms' else 'f'}-{address.lstrip('+')}"

    def inbox_for(self, channel: str, address: str, adapter_id: str) -> dict[str, Any] | None:
        """The inbox that receives mail/texts/faxes for `address`, creating one if allowed."""
        found = self.store.resolve_inbox(channel, address)
        if found:
            return found
        if channel == "email" and not self.cfg.auto_create_inboxes:
            return self.store.catch_all("email")
        made = self.store.create_inboxes([{
            "id": self.inbox_id(channel, address), "channel": channel, "address": address, "adapterId": adapter_id,
            "tags": [], "createdBy": "auto", "createdAt": iso(self.clock.now()),
        }])
        return made[0] if made else self.store.resolve_inbox(channel, address)

    def free_address(self, channel: str) -> str:
        if channel == "email":
            while True:
                address = f"agent-{self.ids.hex(6)}@inbox.test"
                if not self.store.resolve_inbox("email", address):
                    return address
        for area in PHONE_AREAS:
            used = self.store.used_addresses(channel, f"+1{area}55501%")
            for n in range(100):
                candidate = f"+1{area}55501{n:02d}"
                if candidate not in used:
                    return candidate
        raise RuntimeError("No free 555-01xx numbers left")

    # ------------------------------------------------------------ apps

    def port(self, adapter_id: str) -> int:
        return self.cfg.port_for(adapter_id, adapters.get(adapter_id).port_offset)

    def apps(self) -> dict[str, tuple[FastAPI, int]]:
        return {"control": (self.control, self.cfg.control_port)} | {
            adapter_id: (app, self.port(adapter_id)) for adapter_id, app in self.adapter_apps.items()
        }

    # Convenience handles for the built-in adapters.
    @property
    def mailgun(self) -> FastAPI:
        return self.adapter_apps["mailgun"]

    @property
    def telnyx(self) -> FastAPI:
        return self.adapter_apps["telnyx"]

    # ------------------------------------------------------- determinism

    async def settle(self) -> int:
        """Run everything due now. With a frozen clock this never waits."""
        return await self.scheduler.run_due()

    async def advance(self, seconds: float) -> int:
        """Move a FrozenClock forward, running each job at the moment it is due."""
        assert isinstance(self.clock, FrozenClock), "advance() needs a FrozenClock"
        target = self.clock.now() + timedelta(seconds=seconds)
        ran = await self.settle()
        while (nxt := self.scheduler.next_due()) is not None and nxt <= target:
            self.clock.set(max(nxt, self.clock.now()))
            ran += await self.settle()
        self.clock.set(target)
        return ran + await self.settle()

    async def run_until_idle(self, max_seconds: float = 3600) -> int:
        """Advance until no work is scheduled (bounded, so a loop can't spin forever)."""
        assert isinstance(self.clock, FrozenClock)
        ran = await self.settle()
        start = self.clock.now()
        while (nxt := self.scheduler.next_due()) is not None and (nxt - start).total_seconds() <= max_seconds:
            self.clock.set(max(nxt, self.clock.now()))
            ran += await self.settle()
        return ran

    async def aclose(self) -> None:
        await self.http.aclose()

    # ------------------------------------------------------------ serve

    async def serve(self) -> None:
        servers = [
            _Server(uvicorn.Config(app, host=self.cfg.host, port=port, log_level="warning", lifespan="off", access_log=False))
            for app, port in self.apps().values()
        ]
        self._servers = servers
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            # Only possible on the main thread; tests run serve() in a worker thread.
            with contextlib.suppress(NotImplementedError, RuntimeError, ValueError):
                loop.add_signal_handler(sig, self.stop)
        ticker = asyncio.create_task(self.scheduler_loop())
        try:
            async with self.control.state.mcp.session_manager.run():  # the /mcp endpoint
                await asyncio.gather(*(s.serve() for s in servers))
        finally:
            ticker.cancel()
            await self.aclose()

    def stop(self) -> None:
        for s in getattr(self, "_servers", []):
            s.should_exit = True

    @property
    def serving(self) -> bool:
        return bool(getattr(self, "_servers", None)) and all(s.started for s in self._servers)

    async def scheduler_loop(self) -> None:
        while True:
            # reset() swaps the scheduler, so always read the current one.
            self.scheduler.start_due()
            await asyncio.sleep(0.05 if self.scheduler.pending() else 0.25)


class _Server(uvicorn.Server):
    """Several servers share one process; signals are handled once by Emulator.serve."""

    @contextlib.contextmanager
    def capture_signals(self) -> Iterator[None]:
        yield
