"""Fixtures for the whole suite.

Layout:
  tests/contract/   deterministic contract tests (marker: contract), run nightly
  tests/live/       real sockets and the official SDKs (marker: live)
  tests/support/    importable helpers: FakeApp, fixed inputs, schema/signature checks
  tests/golden/     byte-for-byte expected payloads

Determinism comes from the fixtures below:
- FrozenClock: time moves only via `emu.advance(seconds)`.
- Ids(seed=1): every id, token and message-id is reproducible.
- FakeApp: the app under test, in-process; webhooks reach it through an httpx
  MockTransport and it answers with scripted statuses.
- Provider APIs and the control API are called through ASGITransport.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable, Iterator
from typing import Any

import httpx
import pytest

from phonybox.clock import FrozenClock
from phonybox.config import Config
from phonybox.emulator import Emulator
from phonybox.ids import Ids
from tests.support import GOLDEN, TESTS
from tests.support.db import TEST_DATABASE_URL, database, drop_test_schemas
from tests.support.fakes import MG_KEY, START, TX_KEY, FakeApp

_MARKERS = {"contract": pytest.mark.contract, "live": pytest.mark.live}


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption("--update-golden", action="store_true", help="Rewrite tests/golden/* and contracts/control-api.openapi.json from the current output.")


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """A test's folder decides its marker, so `-m contract` / `-m live` can't drift from the layout."""
    for item in items:
        folder = item.path.relative_to(TESTS).parts[0]
        if marker := _MARKERS.get(folder):
            item.add_marker(marker)


def pytest_report_header() -> str:
    return f"phonybox database: {'postgres (' + TEST_DATABASE_URL.split('@')[-1] + ')' if TEST_DATABASE_URL else 'sqlite (memory)'}"


@pytest.fixture(scope="session", autouse=True)
def _drop_postgres_schemas() -> Iterator[None]:
    yield
    drop_test_schemas()


@pytest.fixture
def clock() -> FrozenClock:
    return FrozenClock(START)


@pytest.fixture
def fake_app() -> FakeApp:
    return FakeApp()


@pytest.fixture
def config() -> Config:
    return Config(dataset="empty", db_path=database())


@pytest.fixture
async def emu(clock: FrozenClock, fake_app: FakeApp, config: Config) -> AsyncIterator[Emulator]:
    e = Emulator(config, clock=clock, ids=Ids(seed=1), transport=httpx.MockTransport(fake_app.handler))
    yield e
    await e.aclose()


def _client(app: Any, base: str, **kw: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=base, **kw)


@pytest.fixture
async def control(emu: Emulator) -> AsyncIterator[httpx.AsyncClient]:
    async with _client(emu.control, "http://127.0.0.1:4100") as c:
        yield c


@pytest.fixture
async def mailgun(emu: Emulator) -> AsyncIterator[httpx.AsyncClient]:
    async with _client(emu.mailgun, "http://127.0.0.1:4101", auth=("api", MG_KEY)) as c:
        yield c


@pytest.fixture
async def telnyx(emu: Emulator) -> AsyncIterator[httpx.AsyncClient]:
    async with _client(emu.telnyx, "http://127.0.0.1:4102", headers={"authorization": f"Bearer {TX_KEY}"}) as c:
        yield c


@pytest.fixture
def golden(request: pytest.FixtureRequest) -> Callable[[str, Any], None]:
    """golden("name.json", value): compare with tests/golden/name.json, or rewrite it with --update-golden."""
    update = request.config.getoption("--update-golden")

    def check(name: str, value: Any) -> None:
        path = GOLDEN / name
        text = value if isinstance(value, str) else json.dumps(value, indent=2, sort_keys=True) + "\n"
        if update or not path.exists():
            path.write_bytes(text.encode())
            if not update:
                pytest.fail(f"Created missing golden file {path.name}; review it and re-run.")
            return
        assert text == path.read_bytes().decode(), f"{name} differs from golden. Re-run with --update-golden if the change is intended."

    return check
