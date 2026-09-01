"""Choose a small, maximally-varied set of frames to hand-label first.

    python training/pick_seed.py            # -> training/data/seed_frames/
    python training/pick_seed.py -n 40

The point is to spend as little of a human's time as possible. Labelling every
extracted frame is hours of work and mostly wasted, because consecutive video
frames of the same rig are near-identical -- a model that has seen one has
effectively seen its neighbours.

So: label a seed set, train on it, and let the seed model pre-label the rest
(see propagate_labels.py). This picks the seed by farthest-point sampling over
image appearance, which spreads the choices across lighting, camera view and
belt position rather than clustering them on whatever happened to be filmed
longest.

Two categories are force-included regardless of what the sampler prefers:

* every still showing the joint rupture, because it is one physical defect with
  very few examples and it is the class the whole project is judged on;
* a fixed share of stills, which are sharp and unambiguous, and so are the
  frames where a human's labelling effort produces the cleanest signal.
"""
from __future__ import annotations

import argparse
import csv
import shutil
import sys
import unicodedata
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
FRAMES = ROOT / "data" / "rig_frames"
OUT = ROOT / "data" / "seed_frames"
ASSETS = ROOT.parent / "assets"

# Folder under assets/ holding the rupture photographs. Every frame sourced
# from one of these is force-included.
CRITICAL_FOLDER = "joint rupture"


def fold(text: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in
                   unicodedata.normalize("NFKD", text)
                   .encode("ascii", "ignore").decode()).lower()


def signature(path: Path) -> np.ndarray | None:
    image = cv2.imread(str(path))
    if image is None:
        return None
    small = cv2.resize(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), (32, 32))
    vec = small.astype(np.float32).ravel()
    vec -= vec.mean()
    norm = np.linalg.norm(vec)
    return vec / norm if norm > 1e-6 else vec


def critical_sources() -> set[str]:
    folder = ASSETS / CRITICAL_FOLDER
    if not folder.exists():
        return set()
    return {fold(p.name) for p in folder.iterdir() if p.suffix.lower() == ".jpg"}


def farthest_point(sigs: dict[str, np.ndarray], seeded: list[str],
                   want: int) -> list[str]:
    """Greedily add the frame least similar to everything chosen so far."""
    chosen = list(seeded)
    pool = [n for n in sigs if n not in set(chosen)]
    if not chosen and pool:
        chosen.append(pool.pop(0))

    while len(chosen) < want and pool:
        matrix = np.stack([sigs[n] for n in chosen])
        best, best_score = None, 2.0
        for name in pool:
            worst = float(np.max(matrix @ sigs[name]))  # closest neighbour
            if worst < best_score:
                best_score, best = worst, name
        chosen.append(best)
        pool.remove(best)
    return chosen


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-n", "--count", type=int, default=25)
    ap.add_argument("--min-per-source", type=int, default=3,
                    help="frames guaranteed from each source clip")
    ap.add_argument("--frames", default=str(FRAMES))
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    frames = Path(args.frames)
    manifest = frames / "manifest.csv"
    if not manifest.exists():
        sys.exit(f"No manifest at {manifest}. Run training/extract_frames.py first.")

    rows = list(csv.DictReader(manifest.open()))
    by_name = {r["name"]: r for r in rows}

    print(f"Reading {len(rows)} frames…")
    sigs: dict[str, np.ndarray] = {}
    for row in rows:
        sig = signature(frames / row["name"])
        if sig is not None:
            sigs[row["name"]] = sig

    critical = critical_sources()
    forced = [n for n, r in by_name.items() if fold(r["source"]) in critical]
    print(f"Force-including {len(forced)} rupture still(s): "
          f"{', '.join(sorted(forced)) or 'none found'}")

    # Guarantee a floor per source clip. Farthest-point sampling optimises for
    # variety, so a clip whose frames are all alike -- exactly what a steady
    # shot of a running belt produces -- can be skipped entirely despite being
    # a quarter of the dataset and the closest match to the live feed.
    seeded = list(forced)
    per_group: dict[str, list[str]] = {}
    for name in sigs:
        per_group.setdefault(name.rsplit("_", 1)[0], []).append(name)
    for group, names in sorted(per_group.items()):
        have = sum(1 for n in seeded if n.rsplit("_", 1)[0] == group)
        for name in sorted(names)[::max(1, len(names) // 3)]:
            if have >= args.min_per_source:
                break
            if name not in seeded:
                seeded.append(name)
                have += 1

    if len(seeded) >= args.count:
        chosen = seeded[:args.count]
    else:
        chosen = farthest_point(sigs, seeded, args.count)

    groups: dict[str, int] = {}
    for name in chosen:
        key = name.rsplit("_", 1)[0]
        groups[key] = groups.get(key, 0) + 1
    print(f"\n{len(chosen)} seed frames:")
    for key, n in sorted(groups.items()):
        print(f"   {key:16} {n}")

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return 0

    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for name in sorted(chosen):
        shutil.copy2(frames / name, out / name)

    (out / "seed.txt").write_text("\n".join(sorted(chosen)) + "\n")

    print(f"\n+ {len(chosen)} frames -> {out}")
    print("\nLabel ONLY these in Roboflow — three classes:\n"
          "    tear   hole   joint_damage\n"
          "Do NOT label the healthy seam. It passes every revolution, raises\n"
          "no incident, and labelling it is wasted effort.\n"
          "\nExport as YOLOv8, then run:")
    print("    python training/propagate_labels.py <exported-folder>")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
