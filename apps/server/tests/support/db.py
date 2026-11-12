"""Which database the suite runs against.

Unset PHONYBOX_TEST_DATABASE_URL: SQLite in memory (default, fastest).
Set it to a postgresql:// URL: every emulator gets its own fresh schema in that
database, so tests stay isolated, and schemas are dropped at the end of the run.

    PHONYBOX_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/phonybox uv run pytest
"""

from __future__ import annotations

import itertools
import os

TEST_DATABASE_URL = os.environ.get("PHONYBOX_TEST_DATABASE_URL", "")
_n = itertools.count()
created_schemas: list[str] = []


def database() -> str:
    """A database URL for one emulator."""
    if not TEST_DATABASE_URL:
        return ":memory:"
    schema = f"phonybox_test_{os.getpid()}_{next(_n)}"
    created_schemas.append(schema)
    sep = "&" if "?" in TEST_DATABASE_URL else "?"
    return f"{TEST_DATABASE_URL}{sep}schema={schema}"


def drop_test_schemas() -> None:
    if not (TEST_DATABASE_URL and created_schemas):
        return
    import psycopg

    with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as conn:
        for schema in created_schemas:
            conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')  # type: ignore[arg-type]
    created_schemas.clear()
