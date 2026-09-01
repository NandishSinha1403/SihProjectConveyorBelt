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

sys.path.insert(0, str(ROOT))
from classes import CLASS_NAMES  # noqa: E402

# Roboflow Universe projects covering conveyor belt surface damage.
# `version` is pinned so a re-run reproduces the same dataset.
DATASETS: list[dict] = [
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
        "note": "Belt Joint / Large Hole / Large Tear",
    },
]

# Projects that were unpublished or renamed since this was written. Kept here so
# the reason is recorded rather than rediscovered, and so a failing download is
# never mistaken for a broken script.
UNAVAILABLE: list[dict] = [
    {
        "slug": "conveyor-belt-damage-detection",
        "project": "cctv-tarjun/conveyor-belt-damage-detection-bvgsj-dk03r",
        "reason": "no published versions as of 2026-08 (Roboflow reports "
                  "'Version number 1 is not found')",
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


def download_project(rf, spec: str, dest: str | None) -> int:
    """Fetch one Roboflow project straight into a trainable dataset directory.

    The public datasets go through merge_datasets.py because they disagree about
    class names. A single project of our own footage has one vocabulary already,
    so it is downloaded ready to train on and skips that step entirely.
    """
    parts = spec.split("/")
    if len(parts) != 3:
        sys.exit(f"Expected workspace/project/version, got {spec!r}")
    workspace, project, raw_version = parts
    try:
        version = int(raw_version)
    except ValueError:
        sys.exit(f"Version must be a number, got {raw_version!r}")

    target = Path(dest) if dest else ROOT / "data" / "rig"
    print(f"→ downloading {workspace}/{project} v{version}")
    try:
        handle = rf.workspace(workspace).project(project)
        handle.version(version).download("yolov8", location=str(target),
                                         overwrite=True)
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"✗ download failed: {exc}")

    data_yaml = target / "data.yaml"
    if not data_yaml.exists():
        sys.exit(f"✗ no data.yaml under {target}; the download did not complete")

    # Report the vocabulary rather than assuming it. A Roboflow project renamed
    # a class at some point is exactly the kind of thing that trains a model the
    # backend cannot speak to.
    import re

    names = re.search(r"names:\s*(\[.*?\]|(?:\n\s*-\s*.+)+)", data_yaml.read_text())
    print(f"✓ {target}")
    if names:
        found = re.findall(r"[\w']+", names.group(1))
        print(f"  classes: {' '.join(found)}")
        unknown = [n for n in found if n not in CLASS_NAMES]
        if unknown:
            print(f"  ⚠ outside the canonical vocabulary: {' '.join(unknown)}")
            print(f"    known: {' '.join(CLASS_NAMES)}")
            print("    add them to training/classes.py ALIASES, or rename in "
                  "Roboflow, or the backend will not recognise them.")
    print(f"\nNext: train with --data {data_yaml}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--api-key")
    ap.add_argument("--only", nargs="*", help="download only these slugs")
    ap.add_argument("--list", action="store_true", help="show known datasets and exit")
    ap.add_argument("--project",
                    help="download a single Roboflow project instead of the "
                         "public set, as workspace/project/version — e.g. "
                         "my-workspace/belt-rig/3. Used for the rig-specialised "
                         "model, which trains on our own footage alone and so "
                         "needs no merge step.")
    ap.add_argument("--dest", help="where to put --project (default data/rig)")
    args = ap.parse_args()

    if args.list:
        for d in DATASETS:
            print(f"{d['slug']:34} {d['workspace']}/{d['project']} v{d['version']}")
            print(f"{'':34} {d['note']}")
        if UNAVAILABLE:
            print("\nKnown unavailable:")
            for d in UNAVAILABLE:
                print(f"  {d['slug']:32} {d['project']}")
                print(f"  {'':32} {d['reason']}")
        return 0

    try:
        from roboflow import Roboflow
    except ImportError:
        sys.exit("The roboflow package is required: pip install roboflow")

    rf = Roboflow(api_key=load_api_key(args.api_key))

    if args.project:
        return download_project(rf, args.project, args.dest)

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
