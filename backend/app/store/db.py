"""Postgres persistence for stream sessions and incidents, hosted on Supabase.

Deliberately synchronous rather than async: writes originate on the inference
thread, and a connection pool is simpler and more predictable than marshalling
every insert onto the event loop. Request handlers reach these methods through
``run_in_threadpool``. Volumes here are tiny -- a handful of incidents per
minute, not a firehose -- so a four-connection pool is generous.

The ``incidents`` table is also the substrate for the deferred predictive
phase: defect growth rates and remaining-useful-life estimates are queries over
this history.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id          BIGSERIAL PRIMARY KEY,
    source_uri  TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    label       TEXT NOT NULL,
    detector    TEXT NOT NULL,
    started_at  DOUBLE PRECISION NOT NULL,
    ended_at    DOUBLE PRECISION,
    frames_read INTEGER DEFAULT 0,
    frames_processed INTEGER DEFAULT 0,
    frames_skipped   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS incidents (
    id          BIGSERIAL PRIMARY KEY,
    session_id  BIGINT REFERENCES sessions(id) ON DELETE CASCADE,
    track_id    INTEGER,
    cls         TEXT NOT NULL,
    label       TEXT NOT NULL,
    severity    TEXT NOT NULL,
    confidence  DOUBLE PRECISION NOT NULL,
    opened_at   DOUBLE PRECISION NOT NULL,
    closed_at   DOUBLE PRECISION,
    duration    DOUBLE PRECISION,
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
    def __init__(self, dsn: str) -> None:
        if not dsn:
            raise RuntimeError("DATABASE_URL is not set; see backend/.env.example")
        # prepare_threshold=None: Supabase's transaction pooler multiplexes
        # connections and cannot carry server-side prepared statements.
        self._pool = ConnectionPool(
            conninfo=dsn, min_size=1, max_size=4, open=True,
            kwargs={"row_factory": dict_row, "autocommit": True,
                    "prepare_threshold": None},
        )
        with self._pool.connection() as conn:
            conn.execute(SCHEMA)
        log.info("Database ready")

    def close(self) -> None:
        self._pool.close()

    @property
    def pool(self) -> ConnectionPool:
        """For the maintenance scripts, which need SQL this class does not."""
        return self._pool

    # -- sessions ------------------------------------------------------------

    def start_session(self, source_uri: str, source_kind: str, label: str,
                      detector: str) -> int:
        with self._pool.connection() as conn:
            row = conn.execute(
                "INSERT INTO sessions (source_uri, source_kind, label, detector,"
                " started_at) VALUES (%s,%s,%s,%s,%s) RETURNING id",
                (source_uri, source_kind, label, detector, time.time()),
            ).fetchone()
        return int(row["id"])

    def end_session(self, session_id: int, frames_read: int,
                    frames_processed: int, frames_skipped: int) -> None:
        with self._pool.connection() as conn:
            conn.execute(
                "UPDATE sessions SET ended_at=%s, frames_read=%s,"
                " frames_processed=%s, frames_skipped=%s WHERE id=%s",
                (time.time(), frames_read, frames_processed, frames_skipped,
                 session_id),
            )

    # -- incidents -----------------------------------------------------------

    def insert_incident(self, session_id: int | None, incident: Any,
                        snapshot: str | None) -> int:
        with self._pool.connection() as conn:
            row = conn.execute(
                "INSERT INTO incidents (session_id, track_id, cls, label, severity,"
                " confidence, opened_at, first_frame, last_frame, snapshot, box)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                (session_id, incident.track_id, incident.cls, incident.label,
                 incident.severity.value, incident.confidence, incident.opened_at,
                 incident.first_frame, incident.last_frame, snapshot,
                 json.dumps([round(v, 5) for v in incident.box])),
            ).fetchone()
        return int(row["id"])

    def update_incident(self, row_id: int, severity: str, label: str, cls: str) -> None:
        with self._pool.connection() as conn:
            conn.execute(
                "UPDATE incidents SET severity=%s, label=%s, cls=%s WHERE id=%s",
                (severity, label, cls, row_id),
            )

    def close_incident(self, row_id: int, closed_at: float, duration: float,
                       last_frame: int) -> None:
        with self._pool.connection() as conn:
            conn.execute(
                "UPDATE incidents SET closed_at=%s, duration=%s, last_frame=%s"
                " WHERE id=%s",
                (closed_at, duration, last_frame, row_id),
            )

    def list_incidents(self, limit: int = 100, offset: int = 0,
                       severity: str | None = None, cls: str | None = None,
                       session_id: int | None = None) -> list[dict]:
        clauses, params = [], []
        if severity:
            clauses.append("severity = %s")
            params.append(severity)
        if cls:
            clauses.append("cls = %s")
            params.append(cls)
        if session_id is not None:
            clauses.append("session_id = %s")
            params.append(session_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.extend([limit, offset])
        with self._pool.connection() as conn:
            rows = conn.execute(
                f"SELECT * FROM incidents {where} ORDER BY opened_at DESC"
                " LIMIT %s OFFSET %s", params,
            ).fetchall()
        return [self._row_to_incident(r) for r in rows]

    def count_incidents(self, severity: str | None = None,
                        cls: str | None = None) -> int:
        clauses, params = [], []
        if severity:
            clauses.append("severity = %s")
            params.append(severity)
        if cls:
            clauses.append("cls = %s")
            params.append(cls)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._pool.connection() as conn:
            row = conn.execute(
                f"SELECT COUNT(*) AS n FROM incidents {where}", params).fetchone()
        return int(row["n"])

    def clear_incidents(self, session_id: int | None = None) -> tuple[int, list[str]]:
        """Delete incidents, either for one session or the whole history.

        Returns the row count and the snapshot keys the deleted rows owned, so
        the caller can remove the matching objects from Storage -- a row and
        its evidence image are deleted together, never one without the other.
        """
        where = "WHERE session_id = %s" if session_id is not None else ""
        params = [session_id] if session_id is not None else []
        with self._pool.connection() as conn:
            rows = conn.execute(
                f"DELETE FROM incidents {where} RETURNING snapshot", params
            ).fetchall()
        return len(rows), [r["snapshot"] for r in rows if r["snapshot"]]

    def get_incident(self, row_id: int) -> dict | None:
        with self._pool.connection() as conn:
            row = conn.execute(
                "SELECT * FROM incidents WHERE id=%s", (row_id,)).fetchone()
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
            where = "WHERE opened_at >= %s"
            params = [time.time() - hours * 3600]

        with self._pool.connection() as conn:
            by_class = conn.execute(
                f"SELECT cls, label, COUNT(*) n FROM incidents {where}"
                " GROUP BY cls, label", params).fetchall()
            by_severity = conn.execute(
                f"SELECT severity, COUNT(*) n FROM incidents {where}"
                " GROUP BY severity", params).fetchall()
            total = conn.execute(
                f"SELECT COUNT(*) n FROM incidents {where}", params).fetchone()
            all_time = conn.execute(
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
    def _row_to_incident(row: dict) -> dict:
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
                _db = Database(settings.database_url)
    return _db
