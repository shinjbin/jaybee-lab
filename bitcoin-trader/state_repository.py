from __future__ import annotations

import fcntl
import json
import sqlite3
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path

from models import BotState


def encode(value):
    return json.dumps(value, default=str, ensure_ascii=False, allow_nan=False)


class BotBusy(RuntimeError):
    pass


class StateRepository:
    """Shared local/PVC database per account/symbol; lock spans API calls.

    Intent commits BEFORE submitting. State, processed candle and trade log
    commit together AFTER exchange confirmation.
    """
    def __init__(self, path: str, identity: str, initial: BotState):
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.lock(), self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1),
                    identity TEXT NOT NULL, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS decisions (candle INTEGER PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS trades (order_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS notifications (key TEXT PRIMARY KEY,
                    attempted_at REAL NOT NULL, delivered INTEGER NOT NULL, payload TEXT NOT NULL);
            """)
            row = db.execute("SELECT identity FROM state WHERE id=1").fetchone()
            if row and row[0] != identity:
                raise ValueError("State identity mismatch: separate DBs required for symbol/interval/mode")
            db.execute("INSERT OR IGNORE INTO state VALUES (1, ?, ?)", (identity, encode(asdict(initial))))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            db.execute("PRAGMA synchronous=FULL")
            with db:
                yield db
        finally:
            db.close()

    @contextmanager
    def lock(self):
        with open(str(self.path) + ".lock", "a") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise BotBusy("Another bot owns this state repository") from None
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)

    def load(self) -> BotState:
        with self.connect() as db:
            return BotState.from_dict(json.loads(db.execute("SELECT payload FROM state WHERE id=1").fetchone()[0]))

    def save(self, state: BotState, decision=None, trade=None, event=None):
        with self.connect() as db:
            db.execute("UPDATE state SET payload=? WHERE id=1", (encode(asdict(state)),))
            if decision is not None:
                db.execute("INSERT OR REPLACE INTO decisions VALUES (?, ?)", (decision["open_time"], encode(decision)))
            if trade is not None:
                db.execute("INSERT OR IGNORE INTO trades VALUES (?, ?)", (str(trade["order_id"]), encode(trade)))
            if event is not None:
                db.execute("INSERT INTO events(payload) VALUES (?)", (encode(event),))

    def records(self, table: str):
        if table not in {"decisions", "trades", "events"}:
            raise ValueError("Unknown log table")
        with self.connect() as db:
            return [json.loads(r[0]) for r in db.execute(f"SELECT payload FROM {table} ORDER BY rowid")]

    def notification(self, key):
        with self.connect() as db:
            row = db.execute("SELECT attempted_at, delivered, payload FROM notifications WHERE key=?", (key,)).fetchone()
            return {"attempted_at": row[0], "delivered": bool(row[1]), "payload": json.loads(row[2])} if row else None

    def save_notification(self, key, attempted_at, delivered, payload):
        # Caller holds lock across reservation, external send, and confirmation.
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO notifications VALUES (?, ?, ?, ?)",
                (key, attempted_at, int(delivered), encode(payload)))
