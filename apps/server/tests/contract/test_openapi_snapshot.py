"""Control-API contract snapshot.

contracts/control-api.openapi.json (repo root) is the agreed interface between this server,
the UI (whose TypeScript types are generated from it and checked nightly) and
agents. Any change to request or response shapes shows up here as a diff.

Intended change?  uv run pytest tests/contract/test_openapi_snapshot.py --update-golden
                  (or: pnpm --filter @phonybox/server openapi)
"""

from __future__ import annotations

import json

import pytest

from phonybox.emulator import Emulator
from tests.support import CONTRACTS

SNAPSHOT = CONTRACTS / "control-api.openapi.json"


def normalized(doc: dict) -> str:  # type: ignore[type-arg]
    return json.dumps(doc, indent=2, sort_keys=True) + "\n"


def test_openapi_matches_snapshot(emu: Emulator, request: pytest.FixtureRequest) -> None:
    current = normalized(emu.control.openapi())
    if request.config.getoption("--update-golden") or not SNAPSHOT.exists():
        SNAPSHOT.write_text(current)
        return
    expected = SNAPSHOT.read_text()
    if current != expected:
        cur, exp = json.loads(current), json.loads(expected)
        added = sorted(set(cur["paths"]) - set(exp["paths"]))
        removed = sorted(set(exp["paths"]) - set(cur["paths"]))
        changed_schemas = sorted(
            k for k in set(cur["components"]["schemas"]) | set(exp["components"]["schemas"])
            if cur["components"]["schemas"].get(k) != exp["components"]["schemas"].get(k)
        )
        pytest.fail(
            "Control API changed.\n"
            f"  paths added:     {added}\n  paths removed:   {removed}\n  schemas changed: {changed_schemas}\n"
            "If intended, update the snapshot with --update-golden and regenerate the UI types (pnpm --filter @phonybox/web contract)."
        )


def test_every_route_declares_its_response(emu: Emulator) -> None:
    """Untyped responses would make the snapshot meaningless."""
    doc = emu.control.openapi()
    for path, ops in doc["paths"].items():
        for method, op in ops.items():
            ok = op["responses"].get("200") or op["responses"].get("201")
            if path == "/api/events" or "attachments" in path:
                continue
            assert ok and ok.get("content", {}).get("application/json", {}).get("schema"), f"{method.upper()} {path} has no response schema"
