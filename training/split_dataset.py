"""Split the hand-labelled rig data into train/valid, by time rather than at random.

    python training/split_dataset.py            # -> training/data/rig_dataset/

A random split is wrong for video frames and quietly inflates every number that
follows. Frames 425 and 430 of the same clip are the same picture; put one in
each half and the model is validated on data it effectively trained on, so mAP
comes back near-perfect and means nothing.

So the validation set is a *contiguous tail* of the running-belt clip plus a
sample of stills. Nothing in it appears anywhere in training, which is what makes
the score worth reading.

The held-out field-test video (Movie ...6.43 PM) is separate again and never
enters either half -- see training/evaluate.py --video.
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "data" / "labelled" / "train"
OUT = ROOT / "data" / "rig_dataset"
CLASSES = ["tear", "hole", "joint_damage"]

# Frames of the running-belt clip at or after this index form the validation
# tail. Chosen as roughly the last quarter of that clip.
CLIDEO_VAL_FROM = 425
# Every Nth still also goes to validation, so the sharp close-ups are
# represented on both sides.
STILL_VAL_EVERY = 5


def destination(name: str) -> str:
    if name.startswith("rig_clideo"):
        match = re.search(r"(\d+)\.jpg$", name)
        idx = int(match.group(1)) if match else 0
        return "valid" if idx >= CLIDEO_VAL_FROM else "train"
    if name.startswith("rig_still"):
        match = re.search(r"(\d+)\.jpg$", name)
        idx = int(match.group(1)) if match else 0
        return "valid" if idx % STILL_VAL_EVERY == 0 else "train"
    return "train"


def retarget(data_yaml: Path) -> Path:
    """Point a copied dataset's `path` at wherever it now lives.

    The yaml carries an absolute path (see the note where it is written), so a
    dataset cloned onto another machine references a directory that does not
    exist there. Call this before training anywhere but the machine that
    generated it.
    """
    data_yaml = Path(data_yaml).resolve()
    lines = data_yaml.read_text().splitlines()
    out = [f"path: {data_yaml.parent}" if line.startswith("path:") else line
           for line in lines]
    data_yaml.write_text("\n".join(out) + "\n")
    return data_yaml


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=str(SRC))
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    src = Path(args.src)
    if not (src / "images").exists():
        sys.exit(f"No images under {src}. Run the labelling tool and export first.")

    names = sorted(p.name for p in (src / "images").glob("*.jpg"))
    if not names:
        sys.exit(f"No images in {src / 'images'}")

    plan = {n: destination(n) for n in names}

    # Every rupture example goes to training. There are only six of them, so a
    # validation subset could score 0%, 50% or 100% and mean nothing either way,
    # while costing a third of the signal for the class the project is judged on.
    # Its recall is checked on the held-out field-test video and on the live rig
    # instead, which is the honest test regardless.
    forced = 0
    for name in names:
        txt = src / "labels" / f"{Path(name).stem}.txt"
        if not txt.exists():
            continue
        if any(line.split() and line.split()[0] == "2"
               for line in txt.read_text().splitlines()):
            if plan[name] != "train":
                plan[name] = "train"
                forced += 1
    if forced:
        print(f"Moved {forced} rupture image(s) into train — too few to validate on.\n")

    counts = Counter(plan.values())

    # Per-class instance counts per split, so a class that lands entirely on one
    # side is visible now rather than as a confusing zero in the metrics table.
    per_split: dict[str, Counter] = {"train": Counter(), "valid": Counter()}
    for name, split in plan.items():
        txt = src / "labels" / f"{Path(name).stem}.txt"
        if not txt.exists():
            continue
        empty = True
        for line in txt.read_text().splitlines():
            parts = line.split()
            if len(parts) >= 5:
                empty = False
                idx = int(parts[0])
                per_split[split][CLASSES[idx] if idx < len(CLASSES) else str(idx)] += 1
        if empty:
            per_split[split]["(negative)"] += 1

    print(f"{len(names)} images -> train {counts['train']} · valid {counts['valid']}")
    for split in ("train", "valid"):
        print(f"\n  {split}")
        for cls in CLASSES + ["(negative)"]:
            print(f"    {cls:14} {per_split[split].get(cls, 0)}")

    thin = [c for c in CLASSES if per_split["valid"].get(c, 0) == 0]
    if thin:
        print(f"\n  ! no {', '.join(thin)} in validation — its recall will not be "
              "measurable.\n    With so few instances this is expected; judge that "
              "class on the field test instead.")

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return 0

    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    for split in ("train", "valid"):
        (out / split / "images").mkdir(parents=True)
        (out / split / "labels").mkdir(parents=True)

    for name, split in plan.items():
        shutil.copy2(src / "images" / name, out / split / "images" / name)
        label = src / "labels" / f"{Path(name).stem}.txt"
        target = out / split / "labels" / f"{Path(name).stem}.txt"
        target.write_text(label.read_text() if label.exists() else "")

    # `path` is written absolute for this machine, because Ultralytics resolves
    # a relative one against the working directory rather than against the yaml
    # -- "path: ." silently pointed at the repo root and broke an earlier run.
    #
    # That makes the file machine-specific, so anything reading this dataset
    # elsewhere (the Kaggle notebook, after cloning) must rewrite this line to
    # its own location. `retarget()` below does exactly that.
    (out / "data.yaml").write_text(
        f"path: {out.resolve()}\ntrain: train/images\nval: valid/images\n"
        f"nc: {len(CLASSES)}\nnames:\n"
        + "".join(f"  - {c}\n" for c in CLASSES))

    print(f"\n+ {out}")
    print("  Train with kaggle_rig.ipynb, or locally:")
    print(f"    python training/train.py --data {out / 'data.yaml'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
