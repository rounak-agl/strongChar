"""SQLite metadata plus a content-addressed directory of envelopes. Nothing stored here is plaintext."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, size INTEGER NOT NULL,
  uploader TEXT NOT NULL, created REAL NOT NULL, pinned INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS drafts (spec_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS signatures (job INTEGER, round INTEGER, verifier TEXT, payload_hash TEXT, expiry INTEGER,
  settlement TEXT, signature TEXT, PRIMARY KEY (job, round, verifier));
CREATE TABLE IF NOT EXISTS heartbeats (node TEXT PRIMARY KEY, body TEXT NOT NULL, seen REAL NOT NULL);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
"""


class Store:
    def __init__(self, root: Path):
        self.root = root
        (root / "blobs").mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(root / "coordinator.db", check_same_thread=False, isolation_level=None)
        self.db.executescript(SCHEMA)
        self.lock = threading.Lock()

    def _q(self, sql: str, args: tuple = ()) -> list[tuple]:
        with self.lock:
            return self.db.execute(sql, args).fetchall()

    # ---- blobs -------------------------------------------------------------
    def put_blob(self, blob_id: str, kind: str, text: str, uploader: str) -> bool:
        path = self.root / "blobs" / blob_id
        if path.exists():
            return False
        tmp = path.with_suffix(".part")
        tmp.write_text(text)
        tmp.replace(path)
        self._q("INSERT OR IGNORE INTO blobs VALUES (?,?,?,?,?,0)", (blob_id, kind, len(text), uploader, time.time()))
        return True

    def get_blob(self, blob_id: str) -> tuple[str, str] | None:
        rows = self._q("SELECT kind FROM blobs WHERE id = ?", (blob_id,))
        if not rows:
            return None
        return rows[0][0], (self.root / "blobs" / blob_id).read_text()

    def uploader_bytes(self, uploader: str) -> int:
        return self._q("SELECT COALESCE(SUM(size),0) FROM blobs WHERE uploader = ?", (uploader,))[0][0]

    def pin(self, blob_ids: list[str]) -> None:
        for b in blob_ids:
            self._q("UPDATE blobs SET pinned = 1 WHERE id = ?", (b,))

    def drop_unpinned(self, older_than_s: float) -> int:
        old = self._q("SELECT id FROM blobs WHERE pinned = 0 AND created < ?", (time.time() - older_than_s,))
        for (b,) in old:
            (self.root / "blobs" / b).unlink(missing_ok=True)
            self._q("DELETE FROM blobs WHERE id = ?", (b,))
        return len(old)

    def list_blobs(self) -> list[dict[str, Any]]:
        rows = self._q("SELECT id, kind, size, created, pinned FROM blobs ORDER BY created DESC LIMIT 500")
        return [{"id": i, "kind": k, "size": s, "created": c, "pinned": bool(p)} for i, k, s, c, p in rows]

    # ---- drafts --------------------------------------------------------------
    def put_draft(self, spec_hash: str, owner: str, body: dict) -> None:
        self._q("INSERT OR REPLACE INTO drafts VALUES (?,?,?,?)", (spec_hash, owner, json.dumps(body), time.time()))

    def get_draft(self, spec_hash: str) -> dict | None:
        rows = self._q("SELECT body FROM drafts WHERE spec_hash = ?", (spec_hash,))
        return json.loads(rows[0][0]) if rows else None

    # ---- signatures --------------------------------------------------------
    def put_signature(self, job: int, rnd: int, verifier: str, payload_hash: str, expiry: int, settlement: dict,
                      signature: str) -> None:
        self._q("INSERT OR REPLACE INTO signatures VALUES (?,?,?,?,?,?,?)",
                (job, rnd, verifier.lower(), payload_hash, expiry, json.dumps(settlement), signature))

    def signatures(self, job: int, rnd: int) -> list[dict]:
        rows = self._q("SELECT verifier, payload_hash, expiry, settlement, signature FROM signatures WHERE job=? AND round=?",
                       (job, rnd))
        return [{"verifier": v, "payloadHash": p, "expiry": e, "settlement": json.loads(s), "signature": g}
                for v, p, e, s, g in rows]

    # ---- heartbeats --------------------------------------------------------
    def heartbeat(self, node: str, body: dict) -> None:
        self._q("INSERT OR REPLACE INTO heartbeats VALUES (?,?,?)", (node.lower(), json.dumps(body), time.time()))

    def live_nodes(self, within_s: float = 120) -> dict[str, dict]:
        rows = self._q("SELECT node, body, seen FROM heartbeats WHERE seen > ?", (time.time() - within_s,))
        return {n: {**json.loads(b), "seen": s} for n, b, s in rows}

    def kv_get(self, k: str, default: str | None = None) -> str | None:
        rows = self._q("SELECT v FROM kv WHERE k = ?", (k,))
        return rows[0][0] if rows else default

    def kv_set(self, k: str, v: str) -> None:
        self._q("INSERT OR REPLACE INTO kv VALUES (?,?)", (k, v))
