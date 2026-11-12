from __future__ import annotations

from collections.abc import Iterator

import pytest

from tests.support.live import Live, running


@pytest.fixture(scope="module")
def live() -> Iterator[Live]:
    with running() as live:
        yield live
