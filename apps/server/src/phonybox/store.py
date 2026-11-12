"""All reads and writes. Every write publishes the topics it touched.

Lists are always paged (cursor = offset) with filters and sorts in SQL, and
per-inbox counters are recomputed from indexes on write, so no request ever
loads more than one page of rows.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Generator, Iterable, Iterator
from contextlib import contextmanager
from datetime import timedelta
from typing import Any

from .bus import EventBus, Topic
from .clock import Clock, iso
from .db import Database, Row

PAGE = 100
MAX_PAGE = 500
_CHUNK = 900


def _like(term: str) -> str:
    return "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _page(rows: list[Any], total: int, cursor: int) -> dict[str, Any]:
    nxt = cursor + len(rows)
    return {"items": rows, "total": total, "nextCursor": nxt if nxt < total else None}


def _chunks(ids: list[str]) -> Iterator[list[str]]:
    for i in range(0, len(ids), _CHUNK):
        yield ids[i : i + _CHUNK]


def _qs(n: int) -> str:
    return ",".join("?" * n)


def item_search(item: dict[str, Any]) -> str:
    if item["channel"] == "email":
        parts = [item["subject"], item["from"]["address"], item["from"].get("name", ""), *(t["address"] for t in item["to"]), item["text"][:400]]
    elif item["channel"] == "sms":
        parts = [item["body"], item["appNumber"], item["peerNumber"]]
    else:
        parts = [item["title"], item["appNumber"], item["peerNumber"]]
    return " ".join(parts).lower()


class Conflict(Exception):
    pass


class Store:
    def __init__(self, conn: Database, clock: Clock, bus: EventBus) -> None:
        self.db = conn
        self.clock = clock
        self.bus = bus
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ plumbing

    @contextmanager
    def tx(self) -> Generator[Database]:
        with self._lock:
            self.db.execute("BEGIN")
            try:
                yield self.db
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def _publish(self, *topics: Topic) -> None:
        self.bus.publish(*topics)

    def wipe(self) -> None:
        self._adapters = None
        with self.tx() as db:
            for table in ("inbox_tags", "blobs", "items", "webhooks", "chains", "requests", "inboxes", "opt_outs", "mg_events", "mg_routes", "adapters"):
                db.execute(f"DELETE FROM {table}")

    # ------------------------------------------------------------------- inboxes

    @staticmethod
    def _inbox_row(r: Row) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": r["id"],
            "channel": r["channel"],
            "address": r["address"],
            "adapterId": r["adapter_id"],
            "catchAll": bool(r["catch_all"]),
            "tags": json.loads(r["tags"]),
            "pinned": bool(r["pinned"]),
            "createdBy": r["created_by"],
            "createdAt": r["created_at"],
            "messageCount": r["message_count"],
            "unreadCount": r["unread_count"],
            "lastActivityAt": r["last_activity_at"],
            "failing": r["failing"],
        }
        if r["label"] is not None:
            out["label"] = r["label"]
        return out

    def insert_inboxes(self, inboxes: Iterable[dict[str, Any]], db: Database) -> None:
        rows = list(inboxes)
        db.executemany(
            "INSERT INTO inboxes (id, channel, address, label, adapter_id, catch_all, tags, pinned, created_by, created_at, search)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    i["id"], i["channel"], i["address"], i.get("label"), i["adapterId"], int(i.get("catchAll", False)),
                    json.dumps(i.get("tags", [])), int(i.get("pinned", False)), i["createdBy"], i["createdAt"],
                    f"{i['address']} {i.get('label') or ''}".lower(),
                )
                for i in rows
            ],
        )
        db.executemany(
            "INSERT INTO inbox_tags (inbox_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING",
            [(i["id"], t.lower()) for i in rows for t in i.get("tags", [])],
        )

    def create_inboxes(self, inboxes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Insert; addresses that already exist on the channel are skipped (not an error in bulk)."""
        made: list[dict[str, Any]] = []
        with self.tx() as db:
            for inbox in inboxes:
                if db.execute("SELECT 1 FROM inboxes WHERE channel=? AND address=?", (inbox["channel"], inbox["address"])).fetchone():
                    continue
                base = inbox["id"]
                n = 1
                while db.execute("SELECT 1 FROM inboxes WHERE id=?", (inbox["id"],)).fetchone():
                    n += 1
                    inbox = {**inbox, "id": f"{base}-{n}"}
                self.insert_inboxes([inbox], db)
                made.append(inbox)
        if made:
            self._publish("inboxes")
        return [self.get_inbox(i["id"]) or i for i in made]

    def resolve_inbox(self, channel: str, address: str) -> dict[str, Any] | None:
        r = self.db.execute("SELECT * FROM inboxes WHERE channel=? AND address=?", (channel, address)).fetchone()
        return self._inbox_row(r) if r else None

    def catch_all(self, channel: str) -> dict[str, Any] | None:
        r = self.db.execute("SELECT * FROM inboxes WHERE channel=? AND catch_all=1 LIMIT 1", (channel,)).fetchone()
        return self._inbox_row(r) if r else None

    def get_inbox(self, id_or_address: str) -> dict[str, Any] | None:
        r = self.db.execute(
            "SELECT * FROM inboxes WHERE id=? OR address=? ORDER BY id=? DESC LIMIT 1", (id_or_address, id_or_address, id_or_address)
        ).fetchone()
        return self._inbox_row(r) if r else None

    def _inbox_where(self, q: dict[str, Any]) -> tuple[str, list[Any]]:
        where = ["1=1"]
        params: list[Any] = []
        if q.get("channel"):
            where.append("i.channel = ?")
            params.append(q["channel"])
        for term in (q.get("q") or "").strip().lower().split():
            if term.startswith("tag:") and len(term) > 4:
                where.append("EXISTS (SELECT 1 FROM inbox_tags t WHERE t.inbox_id = i.id AND t.tag LIKE ? ESCAPE '\\')")
                params.append(_like(term[4:])[1:])  # prefix match
            else:
                where.append("i.search LIKE ? ESCAPE '\\'")
                params.append(_like(term))
        f = q.get("filter") or "all"
        if f == "unread":
            where.append("i.unread_count > 0")
        elif f == "pinned":
            where.append("i.pinned = 1")
        elif f == "failing":
            where.append("i.failing > 0")
        elif f == "idle":
            where.append("i.activity < ?")
            params.append(iso(self.clock.now() - timedelta(hours=24)))
        return " AND ".join(where), params

    _SORTS = {
        "activity": "i.activity DESC, i.id",
        "unread": "i.unread_count DESC, i.activity DESC, i.id",
        "name": "lower(coalesce(i.label, i.address)) COLLATE natsort, i.id",
        "created": "i.created_at DESC, i.id",
    }

    def list_inboxes(self, q: dict[str, Any], cursor: int = 0, limit: int = PAGE) -> dict[str, Any]:
        where, params = self._inbox_where(q)
        order = self._SORTS.get(q.get("sort") or "activity", self._SORTS["activity"])
        limit = max(1, min(limit, MAX_PAGE))
        total = self.db.execute(f"SELECT count(*) FROM inboxes i WHERE {where}", params).fetchone()[0]
        rows = self.db.execute(f"SELECT * FROM inboxes i WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?", [*params, limit, cursor]).fetchall()
        return _page([self._inbox_row(r) for r in rows], total, cursor)

    def selection_ids(self, ids: list[str] | None, query: dict[str, Any] | None, except_: list[str]) -> list[str]:
        if ids is not None:
            found: list[str] = []
            for chunk in _chunks(ids):
                found += [r[0] for r in self.db.execute(f"SELECT id FROM inboxes WHERE id IN ({_qs(len(chunk))})", chunk)]
            return found
        where, params = self._inbox_where(query or {})
        skip = set(except_)
        return [r[0] for r in self.db.execute(f"SELECT i.id FROM inboxes i WHERE {where}", params) if r[0] not in skip]

    def recount(self, inbox_ids: Iterable[str], db: Database | None = None) -> None:
        db = db or self.db
        ids = list(dict.fromkeys(inbox_ids))
        sql = """
          UPDATE inboxes SET
            message_count = (SELECT count(*) FROM items WHERE inbox_id = inboxes.id),
            unread_count = (SELECT count(*) FROM items WHERE inbox_id = inboxes.id AND read = 0),
            last_activity_at = (SELECT max(created_at) FROM items WHERE inbox_id = inboxes.id),
            failing = (SELECT count(*) FROM chains c JOIN items it ON it.id = c.related_id
                       WHERE it.inbox_id = inboxes.id AND c.failing = 1)
        """
        for chunk in _chunks(ids):
            db.execute(f"{sql} WHERE id IN ({_qs(len(chunk))})", chunk)

    def recount_all(self, db: Database) -> None:
        """Rebuild every inbox's counters with set-based updates (fast on both backends)."""
        db.execute("UPDATE inboxes SET message_count = 0, unread_count = 0, last_activity_at = NULL, failing = 0")
        db.execute("""
          UPDATE inboxes SET message_count = a.n, unread_count = a.unread, last_activity_at = a.last
          FROM (SELECT inbox_id, count(*) AS n, sum(1 - read) AS unread, max(created_at) AS last FROM items GROUP BY inbox_id) AS a
          WHERE a.inbox_id = inboxes.id
        """)
        db.execute("""
          UPDATE inboxes SET failing = f.n
          FROM (SELECT it.inbox_id, count(*) AS n FROM chains c JOIN items it ON it.id = c.related_id
                WHERE c.failing = 1 GROUP BY it.inbox_id) AS f
          WHERE f.inbox_id = inboxes.id
        """)

    def delete_inboxes(self, ids: list[str]) -> int:
        with self.tx() as db:
            n = 0
            for chunk in _chunks(ids):
                db.execute(f"DELETE FROM blobs WHERE item_id IN (SELECT id FROM items WHERE inbox_id IN ({_qs(len(chunk))}))", chunk)
                n += db.execute(f"DELETE FROM inboxes WHERE catch_all = 0 AND id IN ({_qs(len(chunk))})", chunk).rowcount
        self._publish("inboxes", "items")
        return n

    def clear_inboxes(self, ids: list[str]) -> int:
        with self.tx() as db:
            for chunk in _chunks(ids):
                db.execute(f"DELETE FROM blobs WHERE item_id IN (SELECT id FROM items WHERE inbox_id IN ({_qs(len(chunk))}))", chunk)
                db.execute(f"DELETE FROM items WHERE inbox_id IN ({_qs(len(chunk))})", chunk)
            self.recount(ids, db)
        self._publish("inboxes", "items")
        return len(ids)

    def mark_inboxes_read(self, ids: list[str]) -> int:
        with self.tx() as db:
            for chunk in _chunks(ids):
                rows = db.execute(f"SELECT id, data FROM items WHERE read = 0 AND inbox_id IN ({_qs(len(chunk))})", chunk).fetchall()
                db.executemany(
                    "UPDATE items SET read = 1, data = ? WHERE id = ?",
                    [(json.dumps({**json.loads(r["data"]), "read": True}), r["id"]) for r in rows],
                )
            self.recount(ids, db)
        self._publish("inboxes", "items")
        return len(ids)

    def set_pinned(self, ids: list[str], pinned: bool) -> int:
        with self.tx() as db:
            for chunk in _chunks(ids):
                db.execute(f"UPDATE inboxes SET pinned = ? WHERE id IN ({_qs(len(chunk))})", [int(pinned), *chunk])
        self._publish("inboxes")
        return len(ids)

    def channel_stats(self) -> list[dict[str, Any]]:
        out = []
        for channel in ("email", "sms", "fax"):
            inboxes, unread = self.db.execute(
                "SELECT count(*), coalesce(sum(unread_count), 0) FROM inboxes WHERE channel = ?", (channel,)
            ).fetchone()
            items = self.db.execute("SELECT count(*) FROM items WHERE channel = ?", (channel,)).fetchone()[0]
            out.append({"channel": channel, "inboxes": inboxes, "unread": unread, "items": items})
        return out

    def used_addresses(self, channel: str, like: str) -> set[str]:
        return {r[0] for r in self.db.execute("SELECT address FROM inboxes WHERE channel=? AND address LIKE ?", (channel, like))}

    # --------------------------------------------------------------------- items

    def insert_items(self, items: Iterable[tuple[dict[str, Any], dict[str, Any] | None]], db: Database) -> None:
        db.executemany(
            "INSERT INTO items (id, channel, inbox_id, adapter_id, direction, created_at, read, status, app_number, provider_id, search, data, heavy)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    it["id"], it["channel"], it["inboxId"], it["adapterId"], it["direction"], it["createdAt"], int(it["read"]),
                    it["status"], it.get("appNumber"), it.get("providerId"), item_search(it), json.dumps(it),
                    json.dumps(heavy) if heavy else None,
                )
                for it, heavy in items
            ],
        )

    def add_item(self, item: dict[str, Any], heavy: dict[str, Any] | None = None, blobs: list[tuple[str, str, bytes]] | None = None) -> dict[str, Any]:
        with self.tx() as db:
            self.insert_items([(item, heavy)], db)
            for idx, (filename, ctype, data) in enumerate(blobs or []):
                db.execute("INSERT INTO blobs (item_id, idx, filename, content_type, data) VALUES (?,?,?,?,?)", (item["id"], idx, filename, ctype, data))
            self.recount([item["inboxId"]], db)
        self._publish("items", "inboxes")
        return item

    def update_item(self, item_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        with self.tx() as db:
            r = db.execute("SELECT data, inbox_id FROM items WHERE id = ?", (item_id,)).fetchone()
            if not r:
                return None
            data = {**json.loads(r["data"]), **patch}
            db.execute(
                "UPDATE items SET data = ?, status = ?, read = ?, search = ? WHERE id = ?",
                (json.dumps(data), data["status"], int(data["read"]), item_search(data), item_id),
            )
            self.recount([r["inbox_id"]], db)
        self._publish("items", "inboxes")
        return data

    def get_item(self, item_id: str) -> dict[str, Any] | None:
        r = self.db.execute("SELECT data, heavy FROM items WHERE id = ?", (item_id,)).fetchone()
        if not r:
            return None
        data = json.loads(r["data"])
        if r["heavy"]:
            data.update(json.loads(r["heavy"]))
        return data

    def item_by_provider_id(self, provider_id: str) -> dict[str, Any] | None:
        r = self.db.execute("SELECT id FROM items WHERE provider_id = ?", (provider_id,)).fetchone()
        return self.get_item(r[0]) if r else None

    def blob(self, item_id: str, idx: int) -> tuple[str, str, bytes] | None:
        r = self.db.execute("SELECT filename, content_type, data FROM blobs WHERE item_id=? AND idx=?", (item_id, idx)).fetchone()
        return (r[0], r[1], bytes(r[2])) if r else None

    def list_items(self, q: dict[str, Any], cursor: int = 0, limit: int = PAGE) -> dict[str, Any]:
        where = ["channel = ?"]
        params: list[Any] = [q["channel"]]
        if q.get("inboxId"):
            where.append("inbox_id = ?")
            params.append(q["inboxId"])
        if q.get("direction"):
            where.append("direction = ?")
            params.append(q["direction"])
        if q.get("since"):
            where.append("created_at > ?")
            params.append(q["since"])
        for term in (q.get("q") or "").strip().lower().split():
            where.append("search LIKE ? ESCAPE '\\'")
            params.append(_like(term))
        w = " AND ".join(where)
        limit = max(1, min(limit, MAX_PAGE))
        total = self.db.execute(f"SELECT count(*) FROM items WHERE {w}", params).fetchone()[0]
        rows = self.db.execute(
            f"SELECT data FROM items WHERE {w} ORDER BY created_at DESC, seq DESC LIMIT ? OFFSET ?", [*params, limit, cursor]
        ).fetchall()
        return _page([json.loads(r[0]) for r in rows], total, cursor)

    def set_items_read(self, ids: list[str], read: bool) -> int:
        changed = 0
        inboxes: set[str] = set()
        with self.tx() as db:
            for chunk in _chunks(ids):
                rows = db.execute(f"SELECT id, inbox_id, data FROM items WHERE read != ? AND id IN ({_qs(len(chunk))})", [int(read), *chunk]).fetchall()
                db.executemany(
                    "UPDATE items SET read = ?, data = ? WHERE id = ?",
                    [(int(read), json.dumps({**json.loads(r["data"]), "read": read}), r["id"]) for r in rows],
                )
                changed += len(rows)
                inboxes.update(r["inbox_id"] for r in rows)
            self.recount(inboxes, db)
        if changed:
            self._publish("items", "inboxes")
        return changed

    def delete_item(self, item_id: str) -> bool:
        with self.tx() as db:
            r = db.execute("SELECT inbox_id FROM items WHERE id = ?", (item_id,)).fetchone()
            if not r:
                return False
            db.execute("DELETE FROM blobs WHERE item_id = ?", (item_id,))
            db.execute("DELETE FROM items WHERE id = ?", (item_id,))
            self.recount([r[0]], db)
        self._publish("items", "inboxes")
        return True

    def conversations(self, inbox_id: str | None, q: str | None, cursor: int = 0, limit: int = PAGE) -> dict[str, Any]:
        params: list[Any] = []
        scope = "channel = 'sms'"
        if inbox_id:
            scope += " AND inbox_id = ?"
            params.append(inbox_id)
        having = ""
        for term in (q or "").strip().lower().split():
            having += " AND lower(i.address || ' ' || coalesce(i.label, '') || ' ' || g.app_number || ' ' || g.last_search) LIKE ? ESCAPE '\\'"
            params.append(_like(term))
        base = f"""
          WITH g AS (
            SELECT inbox_id, app_number, count(*) AS n, sum(1 - read) AS unread, max(created_at) AS last_at,
                   (SELECT x.search FROM items x WHERE x.channel = 'sms' AND x.inbox_id = items.inbox_id AND x.app_number = items.app_number
                     ORDER BY x.created_at DESC, x.seq DESC LIMIT 1) AS last_search
            FROM items WHERE {scope} GROUP BY inbox_id, app_number
          )
          SELECT g.*, i.address, i.label FROM g JOIN inboxes i ON i.id = g.inbox_id WHERE 1=1 {having}
        """
        limit = max(1, min(limit, MAX_PAGE))
        total = self.db.execute(f"SELECT count(*) FROM ({base}) AS conversations", params).fetchone()[0]
        rows = self.db.execute(f"{base} ORDER BY g.last_at DESC, g.inbox_id, g.app_number LIMIT ? OFFSET ?", [*params, limit, cursor]).fetchall()
        out = []
        for r in rows:
            last = self.db.execute(
                "SELECT data FROM items WHERE channel='sms' AND inbox_id=? AND app_number=? ORDER BY created_at DESC, seq DESC LIMIT 1",
                (r["inbox_id"], r["app_number"]),
            ).fetchone()[0]
            conv: dict[str, Any] = {
                "key": f"{r['inbox_id']}|{r['app_number']}",
                "inboxId": r["inbox_id"],
                "inboxAddress": r["address"],
                "appNumber": r["app_number"],
                "last": json.loads(last),
                "count": r["n"],
                "unread": r["unread"],
            }
            if r["label"] is not None:
                conv["inboxLabel"] = r["label"]
            out.append(conv)
        return _page(out, total, cursor)

    def thread(self, inbox_id: str, app_number: str, limit: int = 300) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT data FROM items WHERE channel='sms' AND inbox_id=? AND app_number=? ORDER BY created_at DESC, seq DESC LIMIT ?",
            (inbox_id, app_number, limit),
        ).fetchall()
        return [json.loads(r[0]) for r in reversed(rows)]

    # ------------------------------------------------------------------ webhooks

    def insert_webhooks(self, hooks: Iterable[dict[str, Any]], db: Database) -> set[str]:
        """Insert in chronological order; returns the related item ids whose chains changed.

        Batched: one executemany for the deliveries, one for the final state of each
        (item, event) chain. Later attempts win, matching one-at-a-time insertion.
        """
        rows: list[tuple[Any, ...]] = []
        chains: dict[tuple[str, str], int] = {}
        for w in hooks:
            failing = int(w["status"] is None or w["status"] >= 400)
            rows.append((
                w["id"], w["adapterId"], w["channel"], w["event"], w["url"], w["status"], failing, w["durationMs"], w["attempt"],
                w["maxAttempts"], w["createdAt"], w.get("relatedId"), w.get("error"), json.dumps(w["requestHeaders"]),
                w["requestBody"], w.get("responseBody"),
            ))
            if w.get("relatedId"):
                chains[(w["relatedId"], w["event"])] = failing
        if rows:
            db.executemany(
                "INSERT INTO webhooks (id, adapter_id, channel, event, url, status, failing, duration_ms, attempt, max_attempts,"
                " created_at, related_id, error, request_headers, request_body, response_body) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                rows,
            )
        if chains:
            db.executemany(
                "INSERT INTO chains (related_id, event, failing) VALUES (?,?,?)"
                " ON CONFLICT (related_id, event) DO UPDATE SET failing = excluded.failing",
                [(rid, ev, f) for (rid, ev), f in chains.items()],
            )
        return {rid for rid, _ in chains}

    def add_webhook(self, w: dict[str, Any]) -> dict[str, Any]:
        with self.tx() as db:
            touched = self.insert_webhooks([w], db)
            if touched:
                inboxes = [r[0] for r in db.execute(f"SELECT inbox_id FROM items WHERE id IN ({_qs(len(touched))})", list(touched))]
                self.recount(inboxes, db)
        self._publish("webhooks", "inboxes")
        return w

    @staticmethod
    def _webhook_row(r: Row, full: bool) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": r["id"],
            "adapterId": r["adapter_id"],
            "channel": r["channel"],
            "event": r["event"],
            "url": r["url"],
            "status": r["status"],
            "durationMs": r["duration_ms"],
            "attempt": r["attempt"],
            "maxAttempts": r["max_attempts"],
            "createdAt": r["created_at"],
            "requestHeaders": json.loads(r["request_headers"]) if full else [],
            "requestBody": r["request_body"] if full else "",
        }
        for key, col in (("relatedId", "related_id"), ("error", "error"), ("responseBody", "response_body")):
            if r[col] is not None and (full or key != "responseBody"):
                out[key] = r[col]
        return out

    _WH_LIST = "id, adapter_id, channel, event, url, status, duration_ms, attempt, max_attempts, created_at, related_id, error, '[]' AS request_headers, '' AS request_body, NULL AS response_body"

    def list_webhooks(self, q: dict[str, Any], cursor: int = 0, limit: int = PAGE) -> dict[str, Any]:
        where = ["1=1"]
        params: list[Any] = []
        if q.get("adapterId"):
            where.append("adapter_id = ?")
            params.append(q["adapterId"])
        if q.get("failedOnly"):
            where.append("failing = 1")
        for term in (q.get("q") or "").strip().lower().split():
            where.append("lower(event || ' ' || url || ' ' || coalesce(error, '')) LIKE ? ESCAPE '\\'")
            params.append(_like(term))
        w = " AND ".join(where)
        limit = max(1, min(limit, MAX_PAGE))
        total = self.db.execute(f"SELECT count(*) FROM webhooks WHERE {w}", params).fetchone()[0]
        rows = self.db.execute(
            f"SELECT {self._WH_LIST} FROM webhooks WHERE {w} ORDER BY created_at DESC, seq DESC LIMIT ? OFFSET ?", [*params, limit, cursor]
        ).fetchall()
        return _page([self._webhook_row(r, False) for r in rows], total, cursor)

    def get_webhook(self, wid: str) -> dict[str, Any] | None:
        r = self.db.execute("SELECT * FROM webhooks WHERE id = ?", (wid,)).fetchone()
        return self._webhook_row(r, True) if r else None

    def webhooks_for(self, item_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(f"SELECT {self._WH_LIST} FROM webhooks WHERE related_id = ? ORDER BY created_at, seq", (item_id,)).fetchall()
        return [self._webhook_row(r, False) for r in rows]

    def latest_webhook(self) -> dict[str, Any] | None:
        r = self.db.execute(f"SELECT {self._WH_LIST} FROM webhooks ORDER BY created_at DESC, seq DESC LIMIT 1").fetchone()
        return self._webhook_row(r, False) if r else None

    def failing_count(self) -> int:
        return self.db.execute("SELECT count(*) FROM chains WHERE failing = 1").fetchone()[0]

    def webhook_targets(self) -> list[dict[str, Any]]:
        rows = self.db.execute("""
          SELECT url, min(adapter_id) AS adapter_id, count(*) AS total, sum(failing) AS failed,
                 (SELECT status FROM webhooks w2 WHERE w2.url = w.url ORDER BY created_at DESC, seq DESC LIMIT 1) AS last_status
          FROM webhooks w GROUP BY url ORDER BY url
        """).fetchall()
        return [{"url": r["url"], "adapterId": r["adapter_id"], "total": r["total"], "failed": r["failed"], "lastStatus": r["last_status"]} for r in rows]

    # ------------------------------------------------------------------ requests

    def insert_requests(self, reqs: Iterable[dict[str, Any]], db: Database) -> None:
        db.executemany(
            "INSERT INTO requests (id, adapter_id, method, path, status, duration_ms, created_at, related_id, request_body, response_body)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            [
                (r["id"], r["adapterId"], r["method"], r["path"], r["status"], r["durationMs"], r["createdAt"], r.get("relatedId"),
                 r.get("requestBody"), r.get("responseBody"))
                for r in reqs
            ],
        )

    def add_request(self, r: dict[str, Any]) -> None:
        with self.tx() as db:
            self.insert_requests([r], db)
        self._publish("requests")

    @staticmethod
    def _request_row(r: Row, full: bool) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": r["id"], "adapterId": r["adapter_id"], "method": r["method"], "path": r["path"], "status": r["status"],
            "durationMs": r["duration_ms"], "createdAt": r["created_at"],
        }
        if r["related_id"] is not None:
            out["relatedId"] = r["related_id"]
        if full:
            for key, col in (("requestBody", "request_body"), ("responseBody", "response_body")):
                if r[col] is not None:
                    out[key] = r[col]
        return out

    def list_requests(self, q: dict[str, Any], cursor: int = 0, limit: int = PAGE) -> dict[str, Any]:
        where = ["1=1"]
        params: list[Any] = []
        if q.get("adapterId"):
            where.append("adapter_id = ?")
            params.append(q["adapterId"])
        for term in (q.get("q") or "").strip().lower().split():
            where.append("lower(method || ' ' || path || ' ' || status) LIKE ? ESCAPE '\\'")
            params.append(_like(term))
        w = " AND ".join(where)
        limit = max(1, min(limit, MAX_PAGE))
        total = self.db.execute(f"SELECT count(*) FROM requests WHERE {w}", params).fetchone()[0]
        rows = self.db.execute(f"SELECT * FROM requests WHERE {w} ORDER BY created_at DESC, seq DESC LIMIT ? OFFSET ?", [*params, limit, cursor]).fetchall()
        return _page([self._request_row(r, False) for r in rows], total, cursor)

    def get_request(self, rid: str) -> dict[str, Any] | None:
        r = self.db.execute("SELECT * FROM requests WHERE id = ?", (rid,)).fetchone()
        return self._request_row(r, True) if r else None

    def request_for(self, item_id: str) -> dict[str, Any] | None:
        r = self.db.execute("SELECT * FROM requests WHERE related_id = ? ORDER BY seq LIMIT 1", (item_id,)).fetchone()
        return self._request_row(r, True) if r else None

    # ------------------------------------------------------------------ adapters

    _adapters: dict[str, dict[str, Any]] | None = None

    def adapter_states(self) -> dict[str, dict[str, Any]]:
        """Read on every provider request, so cached until an adapter is written."""
        if self._adapters is None:
            self._adapters = self._load_adapters()
        return {k: {"enabled": v["enabled"], "values": dict(v["values"])} for k, v in self._adapters.items()}

    def _load_adapters(self) -> dict[str, dict[str, Any]]:
        return {r["id"]: {"enabled": bool(r["enabled"]), "values": json.loads(r["values"])} for r in self.db.execute('SELECT id, enabled, "values" FROM adapters ORDER BY id')}

    def adapter_state(self, adapter_id: str) -> dict[str, Any]:
        return self.adapter_states().get(adapter_id) or {"enabled": False, "values": {}}

    def put_adapter(self, adapter_id: str, enabled: bool, values: dict[str, Any], db: Database | None = None) -> None:
        self._adapters = None
        (db or self.db).execute(
            'INSERT INTO adapters (id, enabled, "values") VALUES (?,?,?) ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled, "values" = excluded."values"',
            (adapter_id, int(enabled), json.dumps(values)),
        )

    def patch_adapter(self, adapter_id: str, enabled: bool | None, values: dict[str, Any] | None) -> dict[str, Any]:
        with self.tx() as db:
            cur = self.adapter_state(adapter_id)
            self.put_adapter(
                adapter_id,
                cur["enabled"] if enabled is None else enabled,
                {**cur["values"], **(values or {})},
                db,
            )
        self._publish("adapters")
        return self.adapter_state(adapter_id)

    # ------------------------------------------------------------------ opt-outs

    def opted_out(self, peer: str, app: str) -> bool:
        return self.db.execute("SELECT 1 FROM opt_outs WHERE peer_number=? AND app_number=?", (peer, app)).fetchone() is not None

    def set_opt_out(self, peer: str, app: str, out: bool) -> None:
        with self.tx() as db:
            if out:
                db.execute("INSERT INTO opt_outs VALUES (?, ?) ON CONFLICT DO NOTHING", (peer, app))
            else:
                db.execute("DELETE FROM opt_outs WHERE peer_number=? AND app_number=?", (peer, app))

    # ------------------------------------------------------------- mailgun state

    def add_mg_event(self, domain: str, event: str, recipient: str, timestamp: float, data: dict[str, Any]) -> None:
        with self.tx() as db:
            db.execute("INSERT INTO mg_events (domain, event, recipient, ts, data) VALUES (?,?,?,?,?)", (domain, event, recipient, timestamp, json.dumps(data)))

    def mg_events(self, domain: str, *, event: str | None, recipient: str | None, ascending: bool, limit: int, offset: int) -> list[dict[str, Any]]:
        where = ["domain = ?"]
        params: list[Any] = [domain]
        if event:
            where.append("event = ?")
            params.append(event)
        if recipient:
            where.append("recipient = ?")
            params.append(recipient.lower())
        order = "ASC" if ascending else "DESC"
        rows = self.db.execute(
            f"SELECT data FROM mg_events WHERE {' AND '.join(where)} ORDER BY ts {order}, seq {order} LIMIT ? OFFSET ?", [*params, limit, offset]
        ).fetchall()
        return [json.loads(r[0]) for r in rows]

    def add_route(self, route: dict[str, Any]) -> None:
        with self.tx() as db:
            db.execute(
                "INSERT INTO mg_routes VALUES (?,?,?,?,?,?)",
                (route["id"], route["priority"], route["expression"], json.dumps(route["actions"]), route["description"], route["created_at"]),
            )

    def routes(self) -> list[dict[str, Any]]:
        return [
            {"id": r[0], "priority": r[1], "expression": r[2], "actions": json.loads(r[3]), "description": r[4], "created_at": r[5]}
            for r in self.db.execute("SELECT * FROM mg_routes ORDER BY priority, created_at")
        ]
