"""Delete incidents from the history, and the snapshot JPEGs they own.

    python backend/scripts/prune_incidents.py --cls belt_joint --dry-run
    python backend/scripts/prune_incidents.py --cls belt_joint
    python backend/scripts/prune_incidents.py --before 2026-09-01   # clear test runs
    python backend/scripts/prune_incidents.py --orphan-snapshots    # tidy disk only

Two jobs this exists for:

* ``belt_joint`` no longer opens incidents (see NON_INCIDENT_CLASSES in
  app/pipeline/events.py), so any rows recorded before that change are dead
  weight in the Incidents page and the CSV export.
* A demo is more legible when the history holds the defects being demonstrated
  rather than a month of development runs.

Deletes are reported before they happen and refuse to run without ``--yes``
unless the terminal is interactive, because an incident history is evidence.
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent   # backend/
DB_PATH = BASE_DIR / "data" / "conveyor.db"
SNAPSHOT_DIR = BASE_DIR / "media" / "snapshots"


def parse_date(text: str) -> float:
    try:
        return time.mktime(time.strptime(text, "%Y-%m-%d"))
    except ValueError:
        sys.exit(f"Could not read {text!r} as a date. Use YYYY-MM-DD.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=str(DB_PATH))
    ap.add_argument("--cls", action="append", default=[],
                    help="delete incidents of this class (repeatable)")
    ap.add_argument("--before", help="delete incidents opened before YYYY-MM-DD")
    ap.add_argument("--all", action="store_true", help="delete every incident")
    ap.add_argument("--orphan-snapshots", action="store_true",
                    help="also delete snapshot files no incident references")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--yes", action="store_true", help="skip the confirmation")
    args = ap.parse_args()

    db = Path(args.db)
    if not db.exists():
        sys.exit(f"No database at {db}")
    if not (args.cls or args.before or args.all or args.orphan_snapshots):
        sys.exit("Nothing selected. Pass --cls, --before, --all or "
                 "--orphan-snapshots (see --help).")

    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row

    where, params = [], []
    if not args.all:
        if args.cls:
            where.append(f"cls IN ({','.join('?' * len(args.cls))})")
            params.extend(args.cls)
        if args.before:
            where.append("opened_at < ?")
            params.append(parse_date(args.before))
    clause = f" WHERE {' OR '.join(where)}" if where else ""

    rows = []
    if args.cls or args.before or args.all:
        rows = conn.execute(
            f"SELECT id, cls, severity, snapshot FROM incidents{clause}", params
        ).fetchall()

        total = conn.execute("SELECT COUNT(*) FROM incidents").fetchone()[0]
        print(f"{len(rows)} of {total} incidents selected for deletion:")
        counts: dict[str, int] = {}
        for row in rows:
            counts[row["cls"]] = counts.get(row["cls"], 0) + 1
        for cls, n in sorted(counts.items(), key=lambda kv: -kv[1]):
            print(f"   {cls:14} {n:6}")
        if not rows:
            print("   (nothing matched)")

    orphans: list[Path] = []
    if args.orphan_snapshots:
        referenced = {r[0] for r in conn.execute(
            "SELECT snapshot FROM incidents WHERE snapshot IS NOT NULL")}
        doomed = {row["snapshot"] for row in rows if row["snapshot"]}
        if SNAPSHOT_DIR.exists():
            orphans = [p for p in SNAPSHOT_DIR.iterdir()
                       if p.is_file() and p.suffix == ".jpg"
                       and (p.name not in referenced or p.name in doomed)]
        print(f"\n{len(orphans)} snapshot files unreferenced after this delete.")

    if args.dry_run:
        print("\n--dry-run: nothing deleted.")
        conn.close()
        return 0

    if not args.yes and sys.stdin.isatty():
        reply = input("\nDelete these permanently? [y/N] ").strip().lower()
        if reply != "y":
            print("Cancelled.")
            conn.close()
            return 1
    elif not args.yes:
        sys.exit("\nRefusing to delete without --yes in a non-interactive shell.")

    removed_files = 0
    for row in rows:
        if row["snapshot"]:
            path = SNAPSHOT_DIR / row["snapshot"]
            if path.exists():
                path.unlink()
                removed_files += 1
    for path in orphans:
        if path.exists():
            path.unlink()
            removed_files += 1

    if rows:
        conn.executemany("DELETE FROM incidents WHERE id = ?",
                         [(row["id"],) for row in rows])
        conn.commit()
    conn.execute("VACUUM")
    conn.close()

    print(f"\n+ {len(rows)} incidents deleted")
    print(f"+ {removed_files} snapshot files removed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
