"""Shared test helpers. Fixtures live in tests/conftest.py; everything importable lives here."""

from pathlib import Path

TESTS = Path(__file__).resolve().parents[1]
REPO = TESTS.parents[2]
#: Language-neutral contracts shared with the web app.
CONTRACTS = REPO / "contracts"
GOLDEN = TESTS / "golden"
