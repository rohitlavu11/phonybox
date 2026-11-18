"""PostgreSQL connections: signing in to Cloud SQL as the service account, and carrying on
after the server drops the connection (a restart, a failover, maintenance)."""

from __future__ import annotations

from urllib.parse import urlsplit

import psycopg
import pytest

from phonybox import db
from tests.support.db import TEST_DATABASE_URL, database

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="needs PHONYBOX_TEST_DATABASE_URL")


def test_gcp_iam_signs_in_with_the_service_account_token_as_the_password(monkeypatch: pytest.MonkeyPatch) -> None:
    password = urlsplit(TEST_DATABASE_URL).password or ""
    url = database().replace(f":{password}@", "@", 1) + "&auth=gcp-iam"  # no password in the URL

    monkeypatch.setattr(db, "gcp_access_token", lambda: "not-the-password")
    with pytest.raises(psycopg.OperationalError):
        db.connect(url)

    monkeypatch.setattr(db, "gcp_access_token", lambda: password)
    assert db.connect(url).execute("SELECT 1").fetchone()[0] == 1


def test_the_statement_after_a_dropped_connection_runs_on_a_new_one() -> None:
    pg = db.connect(database())
    pid = pg.execute("SELECT pg_backend_pid()").fetchone()[0]
    with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as admin:
        admin.execute("SELECT pg_terminate_backend(%s)", (pid,))

    with pytest.raises(psycopg.OperationalError):
        pg.execute("SELECT 1")
    assert pg.execute("SELECT count(*) FROM inboxes").fetchone()[0] == 0, "back on its own schema"
    assert pg.execute("SELECT pg_backend_pid()").fetchone()[0] != pid
