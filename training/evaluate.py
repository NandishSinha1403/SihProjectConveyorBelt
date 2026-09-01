"""Evaluate trained weights and write a report.

    python training/evaluate.py
    python training/evaluate.py --weights training/runs/belt_v1/weights/best.pt

Prints overall and per-class mAP alongside the published YOLOv5m baseline from
Guo et al. (Micromachines 2022, Table 5), which measured 82.5% mAP@.5 at 128 FPS
on a 1092-image crack/tear/scratch dataset. Writes docs/model_report.md plus the
PR curves and confusion matrix Ultralytics generates.

Field test -- the number that actually matters:

    python training/evaluate.py --video "assets/all picture /Movie ….mov"
    python training/evaluate.py --images assets

mAP on a validation split drawn from the same source as the training data
flatters a model. `belt_v1` scored 95.3% that way while detecting something in
only 7 of 29 photographs of this project's own rig, and firing on 33% of the
frames of its own test video with every box mislabelled. `--video` and `--images`
measure that directly, on footage never trained on, so the honest number is
reproducible rather than anecdotal.
"""
from __future__ import annotations

import argparse
import shutil
import unicodedata
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _env import ensure_ultralytics_font  # noqa: E402

ensure_ultralytics_font()

ROOT = Path(__file__).resolve().parent
DOCS = ROOT.parent / "docs"
DEFAULT_WEIGHTS = ROOT.parent / "backend" / "models" / "belt_v1.pt"
DEFAULT_DATA = ROOT / "data" / "merged" / "data.yaml"

# Guo et al. 2022, Table 5 — custom belt damage dataset, RTX 2080s, conf 0.5.
PAPER_BASELINE = [
    ("Multi-SVM", "—", 61.3, 28.4),
    ("AdaBoost", "—", 39.8, 23.7),
    ("YOLOv5m", "Focus+CSP", 82.5, 128.0),
    ("SSD300", "VGG16", 81.7, 59.1),
    ("Faster R-CNN", "ResNet-101", 86.4, 7.4),
]


def resolve_media(raw: str) -> Path:
    """Find a media file, tolerating the U+202F in the assets/ filenames.

    macOS screen-capture names contain a narrow no-break space before "PM".
    Retyping such a path by hand produces an ordinary space, and OpenCV then
    fails to open a file that visibly exists -- so fall back to matching on the
    ASCII-folded name rather than reporting "not found".
    """
    path = Path(raw)
    if path.exists():
        return path

    def fold(text: str) -> str:
        return "".join(ch if ch.isalnum() else "_" for ch in
                       unicodedata.normalize("NFKD", text)
                       .encode("ascii", "ignore").decode()).lower()

    wanted = fold(Path(raw).name)
    root = ROOT.parent / "assets"
    if root.exists():
        for candidate in root.rglob("*"):
            if candidate.is_file() and fold(candidate.name) == wanted:
                return candidate
    sys.exit(f"No such file: {raw}")


def field_test(model, paths: list[Path], imgsz: int, conf: float,
               device: str) -> None:
    """Report detection rate and class mix on footage the model never saw."""
    import cv2

    grand = {"frames": 0, "hits": 0, "boxes": 0}
    grand_classes: dict[str, int] = {}

    for path in paths:
        frames = hits = boxes = 0
        classes: dict[str, int] = {}

        if path.suffix.lower() in (".mov", ".mp4", ".m4v", ".avi"):
            cap = cv2.VideoCapture(str(path))
            if not cap.isOpened():
                print(f"  x could not open {path.name}", file=sys.stderr)
                continue
            images = iter(lambda: cap.read(), (False, None))
            for ok, image in images:
                if not ok:
                    break
                result = model.predict(image, imgsz=imgsz, conf=conf,
                                       device=device, verbose=False)[0]
                frames += 1
                n = len(result.boxes)
                hits += n > 0
                boxes += n
                for cls_idx in result.boxes.cls:
                    name = model.names[int(cls_idx)]
                    classes[name] = classes.get(name, 0) + 1
            cap.release()
        else:
            result = model.predict(str(path), imgsz=imgsz, conf=conf,
                                   device=device, verbose=False)[0]
            frames = 1
            n = len(result.boxes)
            hits = int(n > 0)
            boxes = n
            for cls_idx in result.boxes.cls:
                name = model.names[int(cls_idx)]
                classes[name] = classes.get(name, 0) + 1

        grand["frames"] += frames
        grand["hits"] += hits
        grand["boxes"] += boxes
        for name, n in classes.items():
            grand_classes[name] = grand_classes.get(name, 0) + n

        rate = 100 * hits / max(frames, 1)
        mix = "  ".join(f"{k} {v}" for k, v in
                        sorted(classes.items(), key=lambda kv: -kv[1])) or "none"
        print(f"  {path.name[:44]:46} {hits:5}/{frames:<5} ({rate:3.0f}%)  "
              f"{boxes:5} boxes   {mix}")

    if len(paths) > 1:
        rate = 100 * grand["hits"] / max(grand["frames"], 1)
        mix = "  ".join(f"{k} {v}" for k, v in
                        sorted(grand_classes.items(),
                               key=lambda kv: -kv[1])) or "none"
        print(f"  {'-' * 46} {'-' * 24}")
        print(f"  {'TOTAL':46} {grand['hits']:5}/{grand['frames']:<5} "
              f"({rate:3.0f}%)  {grand['boxes']:5} boxes   {mix}")


def collect_media(raw: str) -> list[Path]:
    root = resolve_media(raw)
    if root.is_file():
        return [root]
    suffixes = (".jpg", ".jpeg", ".png", ".mov", ".mp4", ".m4v", ".avi")
    return sorted(p for p in root.rglob("*")
                  if p.is_file() and p.suffix.lower() in suffixes)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weights", default=str(DEFAULT_WEIGHTS))
    ap.add_argument("--data", default=str(DEFAULT_DATA))
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--conf", type=float, default=0.35,
                    help="confidence threshold for the field test")
    ap.add_argument("--video", help="field-test one video, or a folder of them")
    ap.add_argument("--images", help="field-test a folder of stills")
    args = ap.parse_args()

    weights = Path(args.weights)
    if not weights.exists():
        sys.exit(f"No weights at {weights}. Train first: python training/train.py")

    try:
        from ultralytics import YOLO
    except ImportError:
        sys.exit("ultralytics is required: pip install ultralytics")

    sys.path.insert(0, str(ROOT))
    from train import resolve_device

    device = resolve_device(args.device)
    model = YOLO(str(weights))

    # Field test only: it needs no labelled dataset, so it must not demand one.
    if args.video or args.images:
        for flag in (args.video, args.images):
            if not flag:
                continue
            paths = collect_media(flag)
            print(f"\nField test — {weights.name} on {len(paths)} file(s) "
                  f"at conf {args.conf}, {device}:\n")
            field_test(model, paths, args.imgsz, args.conf, device)
        print("\nA detection rate here is not accuracy — it counts frames with "
              "any box.\nCheck the class mix: the right count of the wrong class "
              "is still a failure.")
        return 0

    if not Path(args.data).exists():
        sys.exit(f"No dataset at {args.data}. Run training/merge_datasets.py first.")

    print(f"Validating {weights.name} on {device}…\n")
    metrics = model.val(data=args.data, imgsz=args.imgsz, device=device,
                        project=str(ROOT / "runs"), name="eval", exist_ok=True)

    # Measure throughput on this machine, since the paper's FPS figures are from
    # an RTX 2080s and are not comparable to an Apple silicon laptop.
    import numpy as np

    dummy = np.zeros((args.imgsz, args.imgsz, 3), dtype=np.uint8)
    model.predict(dummy, imgsz=args.imgsz, device=device, verbose=False)  # warm up
    started = time.perf_counter()
    runs = 30
    for _ in range(runs):
        model.predict(dummy, imgsz=args.imgsz, device=device, verbose=False)
    fps = runs / (time.perf_counter() - started)

    names = model.names
    per_class = []
    try:
        for i, cls_idx in enumerate(metrics.box.ap_class_index):
            per_class.append((
                names[int(cls_idx)],
                float(metrics.box.p[i]),
                float(metrics.box.r[i]),
                float(metrics.box.ap50[i]),
                float(metrics.box.ap[i]),
            ))
    except (AttributeError, IndexError):
        print("⚠ Per-class metrics unavailable for this Ultralytics version")

    lines: list[str] = []
    add = lines.append
    add("# Model Evaluation — Conveyor Belt Damage Detection\n")
    add(f"Weights: `{weights.name}`  ")
    add(f"Dataset: `{args.data}`  ")
    add(f"Device: `{device}`  ")
    add(f"Generated: {time.strftime('%Y-%m-%d %H:%M')}\n")

    add("## Overall\n")
    add("| Metric | Value |")
    add("| --- | --- |")
    add(f"| mAP@.5 | **{metrics.box.map50 * 100:.1f}%** |")
    add(f"| mAP@.5:.95 | {metrics.box.map * 100:.1f}% |")
    add(f"| Precision | {metrics.box.mp * 100:.1f}% |")
    add(f"| Recall | {metrics.box.mr * 100:.1f}% |")
    add(f"| Inference throughput | {fps:.1f} FPS ({1000 / fps:.1f} ms/frame) |\n")

    if per_class:
        add("## Per class\n")
        add("| Class | Precision | Recall | mAP@.5 | mAP@.5:.95 |")
        add("| --- | --- | --- | --- | --- |")
        for name, p, r, ap50, ap in per_class:
            add(f"| {name} | {p * 100:.1f}% | {r * 100:.1f}% | "
                f"{ap50 * 100:.1f}% | {ap * 100:.1f}% |")
        add("")

    add("## Published baselines\n")
    add("Guo et al., *Belt Tear Detection for Coal Mining Conveyors*, "
        "Micromachines 2022, Table 5. Their custom dataset holds 1092 images "
        "across crack/tear/scratch; FPS was measured on an NVIDIA RTX 2080s and "
        "is not directly comparable to the figure above.\n")
    add("| Method | Backbone | mAP@.5 | FPS |")
    add("| --- | --- | --- | --- |")
    for method, backbone, m, f in PAPER_BASELINE:
        add(f"| {method} | {backbone} | {m:.1f}% | {f:.1f} |")
    add(f"| **This model** | YOLO11 | **{metrics.box.map50 * 100:.1f}%** | "
        f"**{fps:.1f}** |\n")

    add("> Numbers are not strictly comparable — different datasets, class "
        "counts and hardware. The baseline is here to show the order of "
        "magnitude a well-tuned one-stage detector reaches on this task.\n")

    DOCS.mkdir(parents=True, exist_ok=True)
    (DOCS / "model_report.md").write_text("\n".join(lines))

    # Copy the plots Ultralytics produced so the report is self-contained.
    eval_dir = ROOT / "runs" / "eval"
    for plot in ("confusion_matrix.png", "PR_curve.png", "R_curve.png",
                 "P_curve.png", "F1_curve.png"):
        src = eval_dir / plot
        if src.exists():
            shutil.copy2(src, DOCS / plot)

    print("\n".join(lines))
    print(f"\n✓ Report written to {DOCS / 'model_report.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
