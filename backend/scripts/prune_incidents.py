"""Delete incidents from the history, and the snapshot objects they own.

    python backend/scripts/prune_incidents.py --cls belt_joint --dry-run
    python backend/scripts/prune_incidents.py --cls belt_joint
    python backend/scripts/prune_incidents.py --before 2026-09-01   # clear test runs
    python backend/scripts/prune_incidents.py --orphan-snapshots    # tidy the bucket

Two jobs this exists for:

* ``belt_joint`` no longer opens incidents (see NON_INCIDENT_CLASSES in
  app/pipeline/events.py), so any rows recorded before that change are dead
  weight in the Incidents page and the CSV export.
* A demo is more legible when the history holds the defects being demonstrated
  rather than a month of development runs.

Deletes are reported before they happen and refuse to run without ``--yes``
unless the terminal is interactive, because an incident history is evidence --
and since the move to Supabase it is shared evidence, not a local file someone
can restore from their own disk.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings          # noqa: E402
from app.store import storage            # noqa: E402
from app.store.db import Database        # noqa: E402


def parse_date(text: str) -> float:
    try:
        return time.mktime(time.strptime(text, "%Y-%m-%d"))
    except ValueError:
        sys.exit(f"Could not read {text!r} as a date. Use YYYY-MM-DD.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cls", action="append", default=[],
                    help="delete incidents of this class (repeatable)")
    ap.add_argument("--before", help="delete incidents opened before YYYY-MM-DD")
    ap.add_argument("--all", action="store_true", help="delete every incident")
    ap.add_argument("--orphan-snapshots", action="store_true",
                    help="also delete snapshot objects no incident references")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--yes", action="store_true", help="skip the confirmation")
    args = ap.parse_args()

    if not (args.cls or args.before or args.all or args.orphan_snapshots):
        sys.exit("Nothing selected. Pass --cls, --before, --all or "
                 "--orphan-snapshots (see --help).")

    db = Database(settings.database_url)
    pool = db.pool

    where, params = [], []
    if not args.all:
        if args.cls:
            where.append("cls = ANY(%s)")
            params.append(args.cls)
        if args.before:
            where.append("opened_at < %s")
            params.append(parse_date(args.before))
    clause = f" WHERE {' OR '.join(where)}" if where else ""

    rows = []
    if args.cls or args.before or args.all:
        with pool.connection() as conn:
            rows = conn.execute(
                f"SELECT id, cls, severity, snapshot FROM incidents{clause}", params
            ).fetchall()
            total = conn.execute("SELECT COUNT(*) n FROM incidents").fetchone()["n"]

        print(f"{len(rows)} of {total} incidents selected for deletion:")
        counts: dict[str, int] = {}
        for row in rows:
            counts[row["cls"]] = counts.get(row["cls"], 0) + 1
        for cls, n in sorted(counts.items(), key=lambda kv: -kv[1]):
            print(f"   {cls:14} {n:6}")
        if not rows:
            print("   (nothing matched)")

    orphans: list[str] = []
    if args.orphan_snapshots:
        with pool.connection() as conn:
            referenced = {r["snapshot"] for r in conn.execute(
                "SELECT snapshot FROM incidents WHERE snapshot IS NOT NULL")}
        doomed = {row["snapshot"] for row in rows if row["snapshot"]}
        orphans = [name for name in storage.list_objects()
                   if name not in referenced or name in doomed]
        print(f"\n{len(orphans)} snapshot objects unreferenced after this delete.")

    if args.dry_run:
        print("\n--dry-run: nothing deleted.")
        db.close()
        return 0

    if not args.yes and sys.stdin.isatty():
        reply = input("\nDelete these permanently? [y/N] ").strip().lower()
        if reply != "y":
            print("Cancelled.")
            db.close()
            return 1
    elif not args.yes:
        sys.exit("\nRefusing to delete without --yes in a non-interactive shell.")

    doomed_objects = [row["snapshot"] for row in rows if row["snapshot"]]
    storage.delete(doomed_objects + orphans)

    if rows:
        with pool.connection() as conn:
            conn.execute("DELETE FROM incidents WHERE id = ANY(%s)",
                         ([row["id"] for row in rows],))
    db.close()

    print(f"\n+ {len(rows)} incidents deleted")
    print(f"+ {len(doomed_objects) + len(orphans)} snapshot objects removed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
