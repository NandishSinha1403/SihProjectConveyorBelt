"""Evaluate trained weights and write a report.

    python training/evaluate.py
    python training/evaluate.py --weights training/runs/belt_v1/weights/best.pt

Prints overall and per-class mAP alongside the published YOLOv5m baseline from
Guo et al. (Micromachines 2022, Table 5), which measured 82.5% mAP@.5 at 128 FPS
on a 1092-image crack/tear/scratch dataset. Writes docs/model_report.md plus the
PR curves and confusion matrix Ultralytics generates.
"""
from __future__ import annotations

import argparse
import shutil
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--weights", default=str(DEFAULT_WEIGHTS))
    ap.add_argument("--data", default=str(DEFAULT_DATA))
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default="auto")
    args = ap.parse_args()

    weights = Path(args.weights)
    if not weights.exists():
        sys.exit(f"No weights at {weights}. Train first: python training/train.py")
    if not Path(args.data).exists():
        sys.exit(f"No dataset at {args.data}. Run training/merge_datasets.py first.")

    try:
        from ultralytics import YOLO
    except ImportError:
        sys.exit("ultralytics is required: pip install ultralytics")

    sys.path.insert(0, str(ROOT))
    from train import resolve_device

    device = resolve_device(args.device)
    model = YOLO(str(weights))

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
