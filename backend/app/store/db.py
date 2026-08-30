"""SQLite persistence for stream sessions and incidents.

Deliberately synchronous and lock-guarded rather than async: writes originate on
the inference thread, and a plain lock is simpler and more predictable than
marshalling every insert onto the event loop. Volumes here are tiny -- a handful
of incidents per minute, not a firehose.

The ``incidents`` table is also the substrate for the deferred predictive
phase: defect growth rates and remaining-useful-life estimates are queries over
this history.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_uri  TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    label       TEXT NOT NULL,
    detector    TEXT NOT NULL,
    started_at  REAL NOT NULL,
    ended_at    REAL,
    frames_read INTEGER DEFAULT 0,
    frames_processed INTEGER DEFAULT 0,
    frames_skipped   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS incidents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    track_id    INTEGER,
    cls         TEXT NOT NULL,
    label       TEXT NOT NULL,
    severity    TEXT NOT NULL,
    confidence  REAL NOT NULL,
    opened_at   REAL NOT NULL,
    closed_at   REAL,
    duration    REAL,
    first_frame INTEGER,
    last_frame  INTEGER,
    snapshot    TEXT,
    box         TEXT
);

CREATE INDEX IF NOT EXISTS idx_incidents_session  ON incidents(session_id);
CREATE INDEX IF NOT EXISTS idx_incidents_opened   ON incidents(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
"""


class Database:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False because the inference thread and the request
        # handlers share this connection; the lock provides the serialisation.
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        with self._lock:
            self._conn.executescript(SCHEMA)
            self._conn.commit()
        log.info("Database ready at %s", path)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # -- sessions ------------------------------------------------------------

    def start_session(self, source_uri: str, source_kind: str, label: str,
                      detector: str) -> int:
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO sessions (source_uri, source_kind, label, detector,"
                " started_at) VALUES (?,?,?,?,?)",
                (source_uri, source_kind, label, detector, time.time()),
            )
            self._conn.commit()
            return int(cur.lastrowid)

    def end_session(self, session_id: int, frames_read: int,
                    frames_processed: int, frames_skipped: int) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE sessions SET ended_at=?, frames_read=?, frames_processed=?,"
                " frames_skipped=? WHERE id=?",
                (time.time(), frames_read, frames_processed, frames_skipped, session_id),
            )
            self._conn.commit()

    # -- incidents -----------------------------------------------------------

    def insert_incident(self, session_id: int | None, incident: Any,
                        snapshot: str | None) -> int:
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO incidents (session_id, track_id, cls, label, severity,"
                " confidence, opened_at, first_frame, last_frame, snapshot, box)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (session_id, incident.track_id, incident.cls, incident.label,
                 incident.severity.value, incident.confidence, incident.opened_at,
                 incident.first_frame, incident.last_frame, snapshot,
                 json.dumps([round(v, 5) for v in incident.box])),
            )
            self._conn.commit()
            return int(cur.lastrowid)

    def update_incident(self, row_id: int, severity: str, label: str, cls: str) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE incidents SET severity=?, label=?, cls=? WHERE id=?",
                (severity, label, cls, row_id),
            )
            self._conn.commit()

    def close_incident(self, row_id: int, closed_at: float, duration: float,
                       last_frame: int) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE incidents SET closed_at=?, duration=?, last_frame=? WHERE id=?",
                (closed_at, duration, last_frame, row_id),
            )
            self._conn.commit()

    def list_incidents(self, limit: int = 100, offset: int = 0,
                       severity: str | None = None, cls: str | None = None,
                       session_id: int | None = None) -> list[dict]:
        clauses, params = [], []
        if severity:
            clauses.append("severity = ?")
            params.append(severity)
        if cls:
            clauses.append("cls = ?")
            params.append(cls)
        if session_id is not None:
            clauses.append("session_id = ?")
            params.append(session_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.extend([limit, offset])
        with self._lock:
            rows = self._conn.execute(
                f"SELECT * FROM incidents {where} ORDER BY opened_at DESC"
                " LIMIT ? OFFSET ?", params,
            ).fetchall()
        return [self._row_to_incident(r) for r in rows]

    def count_incidents(self, severity: str | None = None,
                        cls: str | None = None) -> int:
        clauses, params = [], []
        if severity:
            clauses.append("severity = ?")
            params.append(severity)
        if cls:
            clauses.append("cls = ?")
            params.append(cls)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._lock:
            row = self._conn.execute(
                f"SELECT COUNT(*) AS n FROM incidents {where}", params).fetchone()
        return int(row["n"])

    def get_incident(self, row_id: int) -> dict | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM incidents WHERE id=?", (row_id,)).fetchone()
        return self._row_to_incident(row) if row else None

    def summary(self, hours: float | None = None) -> dict:
        """Aggregates for the dashboard header and the belt-health gauge.

        ``hours`` restricts the window. Belt health is a statement about the
        belt's condition *now*, so the gauge asks for a recent window: an
        all-time count would only ever ratchet downwards and would still be
        reporting last month's repaired tear as if it were live.
        """
        where, params = "", []
        if hours is not None:
            where = "WHERE opened_at >= ?"
            params = [time.time() - hours * 3600]

        with self._lock:
            by_class = self._conn.execute(
                f"SELECT cls, label, COUNT(*) n FROM incidents {where}"
                " GROUP BY cls, label", params).fetchall()
            by_severity = self._conn.execute(
                f"SELECT severity, COUNT(*) n FROM incidents {where}"
                " GROUP BY severity", params).fetchall()
            total = self._conn.execute(
                f"SELECT COUNT(*) n FROM incidents {where}", params).fetchone()
            all_time = self._conn.execute(
                "SELECT COUNT(*) n FROM incidents").fetchone()

        return {
            "total": int(total["n"]),
            "all_time": int(all_time["n"]),
            "window_hours": hours,
            "by_class": {r["cls"]: {"label": r["label"], "count": int(r["n"])}
                         for r in by_class},
            "by_severity": {r["severity"]: int(r["n"]) for r in by_severity},
        }

    @staticmethod
    def _row_to_incident(row: sqlite3.Row) -> dict:
        d = dict(row)
        try:
            d["box"] = json.loads(d["box"]) if d.get("box") else []
        except (TypeError, ValueError):
            d["box"] = []
        return d


_db: Database | None = None
_db_lock = threading.Lock()


def get_db() -> Database:
    global _db
    if _db is None:
        with _db_lock:
            if _db is None:
                from ..config import settings
                _db = Database(settings.db_path)
    return _db
