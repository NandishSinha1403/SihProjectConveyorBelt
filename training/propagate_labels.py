"""Train a seed model on the hand-labelled frames, then pre-label all the rest.

    python training/propagate_labels.py ~/Downloads/belt-rig-seed-1

Give it the folder Roboflow exported after you labelled the seed set (YOLOv8
format, the one containing data.yaml). It then:

1. trains a small detector on those few labelled images, warm-started from
   belt_v1.pt so it begins from weights that already know what belt damage looks
   like rather than from scratch;
2. runs it over every remaining frame in data/rig_frames/;
3. writes a YOLO-format dataset of images plus predicted labels, ready to upload
   back to Roboflow as **pre-annotated** data.

The result is a draft, not an answer. The point is to convert the human's job
from *drawing* several hundred boxes into *correcting* them, which is roughly an
order of magnitude less work. Expect to delete some false positives and add some
missed defects -- the review still matters, and the model is only as good as the
seed it was given.

Confidence deliberately defaults low. A missing box has to be drawn from
scratch; a spurious one is deleted with a keystroke, so recall is worth more
than precision here.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _env import ensure_ultralytics_font  # noqa: E402

ensure_ultralytics_font()

ROOT = Path(__file__).resolve().parent
FRAMES = ROOT / "data" / "rig_frames"
OUT = ROOT / "data" / "prelabelled"
WARM_START = ROOT.parent / "backend" / "models" / "belt_v1.pt"


def read_names(data_yaml: Path) -> list[str]:
    import yaml

    cfg = yaml.safe_load(data_yaml.read_text())
    names = cfg.get("names")
    if isinstance(names, dict):
        names = [names[k] for k in sorted(names)]
    if not names:
        sys.exit(f"No class names in {data_yaml}")
    return list(names)


def count_instances(export: Path, names: list[str]) -> Counter:
    counts: Counter = Counter()
    for labels in export.rglob("labels"):
        for txt in labels.glob("*.txt"):
            for line in txt.read_text().splitlines():
                parts = line.split()
                if parts:
                    idx = int(parts[0])
                    counts[names[idx] if idx < len(names) else str(idx)] += 1
    return counts


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("export", help="Roboflow YOLOv8 export of the labelled seed")
    ap.add_argument("--frames", default=str(FRAMES))
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--epochs", type=int, default=150)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--conf", type=float, default=0.25,
                    help="low on purpose: a missed box costs more than a "
                         "spurious one when a human is reviewing")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--skip-train", action="store_true",
                    help="reuse the seed model from a previous run")
    args = ap.parse_args()

    export = Path(args.export).expanduser()
    data_yaml = export / "data.yaml"
    if not data_yaml.exists():
        found = list(export.rglob("data.yaml"))
        if not found:
            sys.exit(f"No data.yaml under {export}. Export from Roboflow as "
                     f"YOLOv8 and point at the unzipped folder.")
        data_yaml = found[0]

    names = read_names(data_yaml)
    counts = count_instances(data_yaml.parent, names)
    total = sum(counts.values())

    print(f"Seed export: {data_yaml.parent}")
    print(f"  classes: {' '.join(names)}")
    for name in names:
        print(f"    {name:14} {counts.get(name, 0):5} instances")
    if not total:
        sys.exit("\nNo annotations found. Did the export include labels?")
    if "joint_damage" not in names:
        print("\n⚠ No joint_damage class. The rupture is the headline defect — "
              "if it is unlabelled, the final model cannot detect it.")
    elif counts.get("joint_damage", 0) < 4:
        print(f"\n⚠ Only {counts.get('joint_damage', 0)} joint_damage instances "
              "in the seed. Pre-labels for the rupture will be poor; consider "
              "labelling more of it by hand before propagating.")

    try:
        from ultralytics import YOLO
    except ImportError:
        sys.exit("ultralytics is required: pip install ultralytics")

    from train import resolve_device

    device = resolve_device(args.device)
    run_dir = ROOT / "runs" / "seed"
    best = run_dir / "weights" / "best.pt"

    if args.skip_train and best.exists():
        print(f"\nReusing seed model at {best}")
    else:
        base = str(WARM_START) if WARM_START.exists() else "yolo11n.pt"
        print(f"\nTraining seed model on {device}, from {Path(base).name}…")
        print("(a few minutes — it is a handful of images)\n")
        model = YOLO(base)
        model.train(
            data=str(data_yaml), epochs=args.epochs, imgsz=args.imgsz,
            batch=4, device=device, project=str(ROOT / "runs"), name="seed",
            exist_ok=True, patience=50, seed=0, verbose=False,
            # Little data, so lean on augmentation harder than a full run would.
            hsv_h=0.010, hsv_s=0.40, hsv_v=0.60, degrees=5.0, translate=0.15,
            scale=0.35, shear=2.0, fliplr=0.5, flipud=0.0, mosaic=1.0,
            close_mosaic=10, erasing=0.0,
        )
        if not best.exists():
            sys.exit("Seed training produced no weights — check the output above.")

    model = YOLO(str(best))

    # Anything already hand-labelled is ground truth and must not be
    # overwritten with a prediction, so the targets are whatever the export
    # does not already contain.
    frames = Path(args.frames)
    labelled = {p.name for p in (data_yaml.parent / "train" / "images").glob("*.jpg")}

    # Images the human marked "excluded" are out of the dataset by choice --
    # a different camera angle, an unusable take. Predicting on them wastes
    # time and, worse, drags the reported hit rate down with frames nobody
    # intends to train on, which reads as a weak model when it is not.
    excluded: set[str] = set()
    state = data_yaml.parent / "state.json"
    if state.exists():
        import json
        excluded = {n for n, v in json.loads(state.read_text()).items()
                    if v.get("status") == "excluded"}
        if excluded:
            print(f"\nSkipping {len(excluded)} frames excluded during labelling.")

    targets = sorted(p for p in frames.glob("*.jpg")
                     if p.name not in labelled and p.name not in excluded)
    if not targets:
        print(f"\nAll {len(labelled)} frames are already labelled by hand — "
              "nothing to propagate.")
        print("Skip straight to generating a version and training.")
        return 0
    print(f"\n{len(labelled)} frames hand-labelled; {len(targets)} to predict.")
    print(f"\nPre-labelling {len(targets)} frames at conf {args.conf}…")

    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    (out / "train" / "images").mkdir(parents=True)
    (out / "train" / "labels").mkdir(parents=True)

    hits = 0
    predicted: Counter = Counter()
    for path in targets:
        result = model.predict(str(path), imgsz=args.imgsz, conf=args.conf,
                               device=device, verbose=False)[0]
        lines = []
        for box, cls_idx in zip(result.boxes.xywhn, result.boxes.cls):
            x, y, w, h = (float(v) for v in box)
            idx = int(cls_idx)
            predicted[names[idx] if idx < len(names) else str(idx)] += 1
            lines.append(f"{idx} {x:.6f} {y:.6f} {w:.6f} {h:.6f}")
        hits += bool(lines)
        shutil.copy2(path, out / "train" / "images" / path.name)
        (out / "train" / "labels" / f"{path.stem}.txt").write_text(
            "\n".join(lines) + ("\n" if lines else ""))

    (out / "data.yaml").write_text(
        f"path: {out.resolve()}\ntrain: train/images\nval: train/images\n"
        f"nc: {len(names)}\nnames:\n"
        + "".join(f"  - {n}\n" for n in names)
    )

    rate = 100 * hits / max(len(targets), 1)
    print(f"\n+ {len(targets)} frames -> {out}")
    print(f"  {hits} ({rate:.0f}%) got at least one box")
    for name in names:
        print(f"    {name:14} {predicted.get(name, 0):5} predicted")

    if rate < 50:
        print("\n⚠ Fewer than half the frames got a box. The seed model is weak "
              "— label another 15–20 seed frames and re-run rather than "
              "reviewing this.")
    else:
        print("\nUpload this folder to the same Roboflow project. It carries "
              "annotations,\nso your job is correcting boxes, not drawing them. "
              "Fix the obvious misses\nand delete false positives, then generate "
              "a version and train with kaggle_rig.ipynb.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
