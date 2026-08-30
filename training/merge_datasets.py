"""Merge downloaded datasets into one YOLO dataset with a unified class map.

Reads every dataset under training/data/raw/, remaps each publisher's class
names onto the six canonical classes via training/classes.py, and writes a
single merged dataset to training/data/merged/ with a data.yaml ready for
train.py.

    python training/merge_datasets.py
    python training/merge_datasets.py --report   # class distribution only

Labels whose names cannot be mapped are reported and skipped rather than
silently dropped: an unmapped class is a decision for a human to make, and a
quietly discarded defect type would be invisible until the model failed on it.
"""
from __future__ import annotations

import argparse
import collections
import random
import shutil
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from classes import CLASS_NAMES, canonical  # noqa: E402

ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "data" / "raw"
OUT_DIR = ROOT / "data" / "merged"
SPLITS = ("train", "valid", "test")
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def read_names(dataset: Path) -> list[str]:
    """Class names from a dataset's data.yaml, in class-index order."""
    cfg = yaml.safe_load((dataset / "data.yaml").read_text())
    names = cfg.get("names", [])
    if isinstance(names, dict):  # {0: 'tear', 1: 'hole'}
        return [names[k] for k in sorted(names, key=int)]
    return list(names)


def find_split_dirs(dataset: Path, split: str) -> tuple[Path, Path] | None:
    """Locate (images, labels) for a split, tolerating both common layouts.

    Roboflow exports <split>/images, but some datasets ship images/<split>.
    """
    candidates = [
        (dataset / split / "images", dataset / split / "labels"),
        (dataset / "images" / split, dataset / "labels" / split),
    ]
    for images, labels in candidates:
        if images.is_dir() and labels.is_dir():
            return images, labels
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--report", action="store_true",
                    help="print the class distribution without writing output")
    ap.add_argument("--val-fraction", type=float, default=0.15,
                    help="validation share when a dataset has no valid split")
    args = ap.parse_args()

    if not RAW_DIR.is_dir() or not any(RAW_DIR.iterdir()):
        sys.exit(f"No datasets in {RAW_DIR}. Run training/download_dataset.py first.")

    index_of = {name: i for i, name in enumerate(CLASS_NAMES)}
    counts: collections.Counter[str] = collections.Counter()
    unmapped: collections.Counter[str] = collections.Counter()
    per_split: collections.Counter[str] = collections.Counter()
    pending: list[tuple[Path, Path, str, list[str]]] = []  # img, lbl, split, lines

    rng = random.Random(1337)

    for dataset in sorted(p for p in RAW_DIR.iterdir() if p.is_dir()):
        if not (dataset / "data.yaml").exists():
            print(f"⚠ {dataset.name}: no data.yaml, skipping")
            continue

        names = read_names(dataset)
        mapping: dict[int, int] = {}
        for idx, raw_name in enumerate(names):
            target = canonical(raw_name)
            if target is None:
                unmapped[f"{dataset.name}:{raw_name}"] += 1
                continue
            mapping[idx] = index_of[target]

        print(f"\n{dataset.name}")
        for idx, raw_name in enumerate(names):
            arrow = CLASS_NAMES[mapping[idx]] if idx in mapping else "UNMAPPED — skipped"
            print(f"  {raw_name!r} -> {arrow}")

        available = {s: find_split_dirs(dataset, s) for s in SPLITS}
        # Some publishers ship train only. Without a validation split there is
        # nothing to measure against, so hold one out ourselves.
        needs_holdout = available.get("valid") is None and available.get("test") is None
        if needs_holdout:
            print(f"  no validation split — holding out "
                  f"{args.val_fraction:.0%} of train")

        for split in SPLITS:
            found = available.get(split)
            if found is None:
                continue
            images_dir, labels_dir = found

            for image in sorted(images_dir.iterdir()):
                if image.suffix.lower() not in IMAGE_SUFFIXES:
                    continue
                label = labels_dir / f"{image.stem}.txt"
                if not label.exists():
                    continue

                kept: list[str] = []
                for line in label.read_text().splitlines():
                    parts = line.split()
                    if len(parts) < 5:
                        continue
                    src_cls = int(float(parts[0]))
                    if src_cls not in mapping:
                        continue
                    dst_cls = mapping[src_cls]
                    kept.append(" ".join([str(dst_cls), *parts[1:]]))
                    counts[CLASS_NAMES[dst_cls]] += 1

                # Note: images with no surviving labels are kept as negatives.
                # Belt with no defect teaches the model what healthy rubber
                # looks like and measurably cuts false positives.
                if split == "test":
                    target_split = "valid"      # fold test into val; we report
                elif split == "train" and needs_holdout and rng.random() < args.val_fraction:
                    target_split = "valid"
                else:
                    target_split = split

                pending.append((image, label, target_split, kept))
                per_split[target_split] += 1

    print("\n--- Merged class distribution ---")
    total = sum(counts.values())
    for name in CLASS_NAMES:
        n = counts[name]
        share = f"{100 * n / total:5.1f}%" if total else "    —"
        print(f"  {name:14} {n:6d}  {share}")
    print(f"  {'TOTAL':14} {total:6d}")
    print(f"\nImages per split: {dict(per_split)}")

    if unmapped:
        print("\n⚠ Unmapped source classes (skipped) — add them to "
              "training/classes.py::ALIASES if they matter:")
        for key in unmapped:
            print(f"    {key}")

    # Class imbalance is the headline problem Guo et al. raise for belt datasets
    # (sec. 4.2); surface it here rather than letting it show up as a mysteriously
    # poor per-class mAP after an overnight train.
    if total:
        present = {k: v for k, v in counts.items() if v}
        if present:
            ratio = max(present.values()) / max(1, min(present.values()))
            if ratio > 10:
                print(f"\n⚠ Class imbalance ratio {ratio:.0f}:1. Consider "
                      "oversampling rare classes or weighting the loss.")
        missing = [c for c in CLASS_NAMES if not counts[c]]
        if missing:
            print(f"\n⚠ No examples for: {', '.join(missing)}. The model cannot "
                  "learn these. joint_damage is normally derived at runtime by "
                  "the overlap rule in app/pipeline/events.py rather than trained.")

    # Only emit classes that actually have examples. A model advertising a class
    # it was never shown cannot predict it, and a dead class in the API and the
    # dashboard is worse than an absent one -- it looks like a capability the
    # system does not have.
    trained = [c for c in CLASS_NAMES if counts[c] > 0]
    dropped = [c for c in CLASS_NAMES if counts[c] == 0]
    reindex = {index_of[c]: i for i, c in enumerate(trained)}
    if dropped:
        print(f"\nEmitting {len(trained)} classes: {', '.join(trained)}")
        print(f"Excluded (no examples): {', '.join(dropped)}")

    if args.report:
        return 0

    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    for split in ("train", "valid"):
        (OUT_DIR / split / "images").mkdir(parents=True, exist_ok=True)
        (OUT_DIR / split / "labels").mkdir(parents=True, exist_ok=True)

    for i, (image, _label, split, lines) in enumerate(pending):
        # Prefix with an index so identically named files from different
        # datasets cannot overwrite one another.
        stem = f"{i:06d}_{image.stem}"
        shutil.copy2(image, OUT_DIR / split / "images" / f"{stem}{image.suffix}")
        remapped = []
        for line in lines:
            cls_id, _, rest = line.partition(" ")
            remapped.append(f"{reindex[int(cls_id)]} {rest}")
        (OUT_DIR / split / "labels" / f"{stem}.txt").write_text(
            "\n".join(remapped) + ("\n" if remapped else "")
        )

    (OUT_DIR / "data.yaml").write_text(yaml.safe_dump({
        "path": str(OUT_DIR),
        "train": "train/images",
        "val": "valid/images",
        "nc": len(trained),
        "names": trained,
    }, sort_keys=False))

    print(f"\n✓ Merged dataset written to {OUT_DIR}")
    print("Next: python training/train.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
