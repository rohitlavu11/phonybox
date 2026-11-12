"""Storage backends: SQLite (default) and PostgreSQL.

    phonybox                                       SQLite, in memory
    phonybox --db .phonybox/state.db               SQLite file, survives restarts
    phonybox --db postgresql://user:pw@host/db     PostgreSQL (pip install 'phonybox[postgres]')

The store writes portable SQL with `?` placeholders. Each backend adapts the
few things that differ: placeholder style, column types, the natural-sort
collation, and row access. Rows support both `row["col"]` and `row[0]` on
either backend.

Rows hold the camelCase JSON the control API returns (`data`), plus the columns
needed to filter, sort and count without parsing JSON. Heavy fields (email
HTML/headers, webhook bodies) live in separate columns that list queries skip.
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Iterable, Iterator, Sequence
from typing import Any, Literal, Protocol
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

Dialect = Literal["sqlite", "postgres"]

# Portable DDL. {SERIAL}, {BLOB}, {REAL}, {TEXT} and {GENERATED} are filled per dialect.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS inboxes (
  id               {TEXT} PRIMARY KEY,
  channel          {TEXT} NOT NULL,
  address          {TEXT} NOT NULL,
  label            {TEXT},
  adapter_id       {TEXT} NOT NULL,
  catch_all        INTEGER NOT NULL DEFAULT 0,
  tags             {TEXT} NOT NULL DEFAULT '[]',
  pinned           INTEGER NOT NULL DEFAULT 0,
  created_by       {TEXT} NOT NULL,
  created_at       {TEXT} NOT NULL,
  message_count    INTEGER NOT NULL DEFAULT 0,
  unread_count     INTEGER NOT NULL DEFAULT 0,
  last_activity_at {TEXT},
  failing          INTEGER NOT NULL DEFAULT 0,
  search           {TEXT} NOT NULL,
  activity         {TEXT} GENERATED ALWAYS AS (coalesce(last_activity_at, created_at)) {GENERATED},
  UNIQUE (channel, address)
);
CREATE INDEX IF NOT EXISTS inboxes_activity ON inboxes (channel, activity DESC);
CREATE INDEX IF NOT EXISTS inboxes_created ON inboxes (channel, created_at DESC);

CREATE TABLE IF NOT EXISTS inbox_tags (
  inbox_id {TEXT} NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  tag      {TEXT} NOT NULL,
  PRIMARY KEY (inbox_id, tag)
);
CREATE INDEX IF NOT EXISTS inbox_tags_tag ON inbox_tags (tag);

CREATE TABLE IF NOT EXISTS items (
  seq         {SERIAL},
  id          {TEXT} NOT NULL UNIQUE,
  channel     {TEXT} NOT NULL,
  inbox_id    {TEXT} NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  adapter_id  {TEXT} NOT NULL,
  direction   {TEXT} NOT NULL,
  created_at  {TEXT} NOT NULL,
  read        INTEGER NOT NULL,
  status      {TEXT} NOT NULL,
  app_number  {TEXT},
  provider_id {TEXT},
  search      {TEXT} NOT NULL,
  data        {TEXT} NOT NULL,
  heavy       {TEXT}
);
CREATE INDEX IF NOT EXISTS items_inbox ON items (inbox_id, created_at DESC, seq DESC);
CREATE INDEX IF NOT EXISTS items_channel ON items (channel, created_at DESC, seq DESC);
CREATE INDEX IF NOT EXISTS items_conv ON items (channel, inbox_id, app_number, created_at DESC);
CREATE INDEX IF NOT EXISTS items_provider ON items (provider_id);

CREATE TABLE IF NOT EXISTS blobs (
  item_id      {TEXT} NOT NULL,
  idx          INTEGER NOT NULL,
  filename     {TEXT} NOT NULL,
  content_type {TEXT} NOT NULL,
  data         {BLOB} NOT NULL,
  PRIMARY KEY (item_id, idx)
);

CREATE TABLE IF NOT EXISTS webhooks (
  seq             {SERIAL},
  id              {TEXT} NOT NULL UNIQUE,
  adapter_id      {TEXT} NOT NULL,
  channel         {TEXT} NOT NULL,
  event           {TEXT} NOT NULL,
  url             {TEXT} NOT NULL,
  status          INTEGER,
  failing         INTEGER NOT NULL,
  duration_ms     INTEGER NOT NULL,
  attempt         INTEGER NOT NULL,
  max_attempts    INTEGER NOT NULL,
  created_at      {TEXT} NOT NULL,
  related_id      {TEXT},
  error           {TEXT},
  request_headers {TEXT} NOT NULL,
  request_body    {TEXT} NOT NULL,
  response_body   {TEXT}
);
CREATE INDEX IF NOT EXISTS webhooks_time ON webhooks (created_at DESC, seq DESC);
CREATE INDEX IF NOT EXISTS webhooks_related ON webhooks (related_id);
CREATE INDEX IF NOT EXISTS webhooks_url ON webhooks (url);

-- Latest attempt per (item, event). An inbox is "failing" while any chain's latest attempt failed.
CREATE TABLE IF NOT EXISTS chains (
  related_id {TEXT} NOT NULL,
  event      {TEXT} NOT NULL,
  failing    INTEGER NOT NULL,
  PRIMARY KEY (related_id, event)
);

CREATE TABLE IF NOT EXISTS requests (
  seq           {SERIAL},
  id            {TEXT} NOT NULL UNIQUE,
  adapter_id    {TEXT} NOT NULL,
  method        {TEXT} NOT NULL,
  path          {TEXT} NOT NULL,
  status        INTEGER NOT NULL,
  duration_ms   INTEGER NOT NULL,
  created_at    {TEXT} NOT NULL,
  related_id    {TEXT},
  request_body  {TEXT},
  response_body {TEXT}
);
CREATE INDEX IF NOT EXISTS requests_time ON requests (created_at DESC, seq DESC);
CREATE INDEX IF NOT EXISTS requests_related ON requests (related_id);

CREATE TABLE IF NOT EXISTS adapters (
  id       {TEXT} PRIMARY KEY,
  enabled  INTEGER NOT NULL,
  "values" {TEXT} NOT NULL
);

CREATE TABLE IF NOT EXISTS opt_outs (
  peer_number {TEXT} NOT NULL,
  app_number  {TEXT} NOT NULL,
  PRIMARY KEY (peer_number, app_number)
);

-- Mailgun-specific state.
CREATE TABLE IF NOT EXISTS mg_events (
  seq       {SERIAL},
  domain    {TEXT} NOT NULL,
  event     {TEXT} NOT NULL,
  recipient {TEXT} NOT NULL,
  ts        {REAL} NOT NULL,
  data      {TEXT} NOT NULL
);
CREATE INDEX IF NOT EXISTS mg_events_domain ON mg_events (domain, ts);

CREATE TABLE IF NOT EXISTS mg_routes (
  id          {TEXT} PRIMARY KEY,
  priority    INTEGER NOT NULL,
  expression  {TEXT} NOT NULL,
  actions     {TEXT} NOT NULL,
  description {TEXT} NOT NULL,
  created_at  {TEXT} NOT NULL
);
"""

_TYPES: dict[Dialect, dict[str, str]] = {
    "sqlite": {"SERIAL": "INTEGER PRIMARY KEY", "BLOB": "BLOB", "REAL": "REAL", "TEXT": "TEXT", "GENERATED": "VIRTUAL"},
    # COLLATE "C": byte order, like SQLite, so sorting and ISO-timestamp comparisons match exactly.
    "postgres": {"SERIAL": "BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY", "BLOB": "BYTEA", "REAL": "DOUBLE PRECISION", "TEXT": 'TEXT COLLATE "C"', "GENERATED": "STORED"},
}


def schema(dialect: Dialect) -> str:
    return _SCHEMA.format(**_TYPES[dialect])


class Row(Protocol):
    def __getitem__(self, key: int | str) -> Any: ...
    def __iter__(self) -> Iterator[Any]: ...


class Cursor(Protocol):
    rowcount: int

    def fetchone(self) -> Any: ...
    def fetchall(self) -> list[Any]: ...
    def __iter__(self) -> Iterator[Any]: ...


class Database(Protocol):
    dialect: Dialect

    def execute(self, sql: str, params: Sequence[Any] = ()) -> Cursor: ...
    def executemany(self, sql: str, rows: Iterable[Sequence[Any]]) -> None: ...
    def close(self) -> None: ...


def connect(url: str = ":memory:") -> Database:
    if url.startswith(("postgres://", "postgresql://")):
        return PostgresDatabase(url)
    return SqliteDatabase(url)


def is_postgres(url: str) -> bool:
    return url.startswith(("postgres://", "postgresql://"))


# ------------------------------------------------------------------- sqlite

_NUM = re.compile(r"(\d+)")


def _natural(a: str, b: str) -> int:
    def key(s: str) -> list[object]:
        return [(0, int(p)) if p.isdigit() else (1, p) for p in _NUM.split(s) if p]

    ka, kb = key(a), key(b)
    return (ka > kb) - (ka < kb)


class SqliteDatabase:
    dialect: Dialect = "sqlite"

    def __init__(self, path: str) -> None:
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.create_collation("natsort", _natural)
        self._conn.executescript("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;" + schema("sqlite"))

    def execute(self, sql: str, params: Sequence[Any] = ()) -> Cursor:
        return self._conn.execute(sql, params)  # type: ignore[return-value]

    def executemany(self, sql: str, rows: Iterable[Sequence[Any]]) -> None:
        self._conn.executemany(sql, rows)

    def close(self) -> None:
        self._conn.close()


# ----------------------------------------------------------------- postgres


class _PgRow:
    """Index and column-name access, like sqlite3.Row."""

    __slots__ = ("_keys", "_values")

    def __init__(self, keys: dict[str, int], values: Sequence[Any]) -> None:
        self._keys = keys
        self._values = values

    def __getitem__(self, key: int | str) -> Any:
        return self._values[key if isinstance(key, int) else self._keys[key]]

    def __iter__(self) -> Iterator[Any]:
        return iter(self._values)

    def __len__(self) -> int:
        return len(self._values)


class PostgresDatabase:
    """psycopg 3 in autocommit mode; the store issues BEGIN/COMMIT itself.

    An optional `?schema=name` on the URL keeps phonybox's tables in their own
    schema (created if missing), so it can share a database with your app.
    """

    dialect: Dialect = "postgres"

    def __init__(self, url: str) -> None:
        try:
            import psycopg
        except ImportError as e:  # pragma: no cover - exercised by users without the extra
            raise SystemExit("PostgreSQL support needs psycopg: pip install 'phonybox[postgres]'") from e

        parts = urlsplit(url)
        query = dict(parse_qsl(parts.query))
        self.schema_name = query.pop("schema", None)
        conninfo = urlunsplit(parts._replace(query=urlencode(query)))

        def row_factory(cursor: Any) -> Any:
            keys = {c.name: i for i, c in enumerate(cursor.description or [])}
            return lambda values: _PgRow(keys, values)

        self._conn = psycopg.connect(conninfo, autocommit=True, row_factory=row_factory)
        if self.schema_name:
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", self.schema_name):
                raise ValueError(f"Invalid schema name: {self.schema_name!r}")
            self._conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{self.schema_name}"')
            self._conn.execute(f'SET search_path TO "{self.schema_name}"')
        # ICU numeric collation gives the same natural order as SQLite's natsort ("run 9" < "run 10").
        self._conn.execute("CREATE COLLATION IF NOT EXISTS natsort (provider = icu, locale = 'und-u-kn-true')")
        for statement in _statements(schema("postgres")):
            self._conn.execute(statement)  # type: ignore[arg-type]

    @staticmethod
    def _sql(sql: str) -> str:
        return sql.replace("%", "%%").replace("?", "%s")

    def execute(self, sql: str, params: Sequence[Any] = ()) -> Cursor:
        return self._conn.execute(self._sql(sql), params or None)  # type: ignore[return-value, arg-type]

    def executemany(self, sql: str, rows: Iterable[Sequence[Any]]) -> None:
        with self._conn.cursor() as cur:
            cur.executemany(self._sql(sql), list(rows))  # type: ignore[arg-type]

    def drop_schema(self) -> None:
        if self.schema_name:
            self._conn.execute(f'DROP SCHEMA IF EXISTS "{self.schema_name}" CASCADE')

    def close(self) -> None:
        self._conn.close()


def _statements(script: str) -> list[str]:
    body = "\n".join(line for line in script.splitlines() if not line.strip().startswith("--"))
    return [s.strip() for s in body.split(";") if s.strip()]
