"""Copy the old SQLite history and its snapshot JPEGs into Supabase.

    python backend/scripts/migrate_to_supabase.py --dry-run
    python backend/scripts/migrate_to_supabase.py

One-off, for the history recorded before persistence moved to Supabase.
Sessions are inserted first so incidents can be re-pointed at their new session
ids; the old ids are not preserved, because the target tables may already hold
rows and BIGSERIAL will not be argued with.

The SQLite file is left exactly where it is. It is the only copy of this
history until the run succeeds, and deleting it is not this script's business.
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings          # noqa: E402
from app.store import storage            # noqa: E402
from app.store.db import Database        # noqa: E402

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "conveyor.db"
SNAPSHOT_DIR = BASE_DIR / "media" / "snapshots"

SESSION_COLS = ["source_uri", "source_kind", "label", "detector", "started_at",
                "ended_at", "frames_read", "frames_processed", "frames_skipped"]
INCIDENT_COLS = ["track_id", "cls", "label", "severity", "confidence",
                 "opened_at", "closed_at", "duration", "first_frame",
                 "last_frame", "snapshot", "box"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sqlite", default=str(DB_PATH))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    src_path = Path(args.sqlite)
    if not src_path.exists():
        sys.exit(f"No database at {src_path}")

    src = sqlite3.connect(str(src_path))
    src.row_factory = sqlite3.Row
    sessions = src.execute("SELECT * FROM sessions").fetchall()
    incidents = src.execute("SELECT * FROM incidents ORDER BY id").fetchall()
    src.close()

    files = [SNAPSHOT_DIR / r["snapshot"] for r in incidents if r["snapshot"]]
    present = [p for p in files if p.is_file()]

    print(f"{len(sessions)} sessions, {len(incidents)} incidents")
    print(f"{len(present)} of {len(files)} referenced snapshot files found on disk")
    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return 0

    db = Database(settings.database_url)
    session_ids: dict[int, int] = {}
    with db.pool.connection() as conn:
        for row in sessions:
            new = conn.execute(
                f"INSERT INTO sessions ({','.join(SESSION_COLS)}) VALUES"
                f" ({','.join(['%s'] * len(SESSION_COLS))}) RETURNING id",
                [row[c] for c in SESSION_COLS],
            ).fetchone()
            session_ids[row["id"]] = new["id"]

        for row in incidents:
            conn.execute(
                f"INSERT INTO incidents (session_id,{','.join(INCIDENT_COLS)})"
                f" VALUES ({','.join(['%s'] * (len(INCIDENT_COLS) + 1))})",
                [session_ids.get(row["session_id"])] + [row[c] for c in INCIDENT_COLS],
            )
    db.close()

    uploaded = 0
    for path in present:
        try:
            storage.upload(path.name, path.read_bytes())
            uploaded += 1
        except Exception as exc:  # noqa: BLE001
            print(f"   ! {path.name}: {exc}")

    print(f"\n+ {len(sessions)} sessions, {len(incidents)} incidents inserted")
    print(f"+ {uploaded} snapshots uploaded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
