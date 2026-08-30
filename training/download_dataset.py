"""Download conveyor-belt damage datasets from Roboflow Universe.

Needs a free Roboflow API key (roboflow.com -> Settings -> API keys). Put it in
backend/.env as ROBOFLOW_API_KEY, or pass --api-key.

    pip install roboflow
    python training/download_dataset.py --list
    python training/download_dataset.py            # fetch all known datasets

Downloads land in training/data/raw/<slug>/ in YOLOv8 format. Class names are
left exactly as the publisher wrote them; merge_datasets.py does the remapping.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "data" / "raw"

# Roboflow Universe projects covering conveyor belt surface damage.
# `version` is pinned so a re-run reproduces the same dataset.
DATASETS: list[dict] = [
    {
        "slug": "conveyor-belt-damage-detection",
        "workspace": "cctv-tarjun",
        "project": "conveyor-belt-damage-detection-bvgsj-dk03r",
        "version": 1,
        "note": "Belt Joint / Large Hole / Large Tear",
    },
    {
        "slug": "conveyor-belt-damage-sample",
        "workspace": "sample-wy2mp",
        "project": "conveyor-belt-damage",
        "version": 1,
        "note": "instance segmentation; boxes derived from masks",
    },
    {
        "slug": "conveyor-belt-damage-test",
        "workspace": "test-yfiry",
        "project": "conveyor-belt-damage-ucjlj",
        "version": 1,
        "note": "general belt damage",
    },
]


def load_api_key(explicit: str | None) -> str:
    if explicit:
        return explicit
    if key := os.environ.get("ROBOFLOW_API_KEY"):
        return key

    env_file = ROOT.parent / "backend" / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.strip().startswith("ROBOFLOW_API_KEY="):
                return line.split("=", 1)[1].strip().strip("\"'")

    sys.exit(
        "No Roboflow API key found.\n"
        "Get one free at roboflow.com (Settings > API keys), then either add\n"
        "  ROBOFLOW_API_KEY=your_key\n"
        "to backend/.env, or pass --api-key."
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--api-key")
    ap.add_argument("--only", nargs="*", help="download only these slugs")
    ap.add_argument("--list", action="store_true", help="show known datasets and exit")
    args = ap.parse_args()

    if args.list:
        for d in DATASETS:
            print(f"{d['slug']:34} {d['workspace']}/{d['project']} v{d['version']}")
            print(f"{'':34} {d['note']}")
        return 0

    try:
        from roboflow import Roboflow
    except ImportError:
        sys.exit("The roboflow package is required: pip install roboflow")

    rf = Roboflow(api_key=load_api_key(args.api_key))
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    wanted = [d for d in DATASETS if not args.only or d["slug"] in args.only]
    failures = 0

    for spec in wanted:
        target = RAW_DIR / spec["slug"]
        if (target / "data.yaml").exists():
            print(f"✓ {spec['slug']} already present, skipping")
            continue

        print(f"→ downloading {spec['slug']} ({spec['note']})")
        try:
            project = rf.workspace(spec["workspace"]).project(spec["project"])
            project.version(spec["version"]).download(
                "yolov8", location=str(target), overwrite=True
            )
            print(f"✓ {spec['slug']} -> {target}")
        except Exception as exc:  # noqa: BLE001
            # A single unavailable dataset must not abort the rest: Universe
            # projects get renamed and unpublished without notice.
            failures += 1
            print(f"✗ {spec['slug']} failed: {exc}", file=sys.stderr)

    print(f"\nDone. {len(wanted) - failures}/{len(wanted)} datasets available "
          f"in {RAW_DIR}")
    print("Next: python training/merge_datasets.py")
    return 1 if failures == len(wanted) else 0


if __name__ == "__main__":
    raise SystemExit(main())
