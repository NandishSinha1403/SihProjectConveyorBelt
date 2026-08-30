"""Fine-tune YOLO on the merged conveyor belt damage dataset.

    python training/train.py                        # sensible defaults
    python training/train.py --model yolo11n.pt --epochs 60
    python training/train.py --device cpu

On an Apple silicon Mac this uses the MPS backend. yolo11s at 640px for ~120
epochs is roughly an overnight run on an M2 with 8 GB; drop to yolo11n, or move
to a Colab GPU and copy the resulting weights into backend/models/, if that is
too slow.

Augmentation is tuned for the domain rather than left at COCO defaults:
underground belt imagery is near-monochrome, dusty and low-contrast, so heavy
grayscale, blur and HSV augmentation is what generalises. See Guo et al.,
Micromachines 2022, sec. 4.1.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _env import ensure_ultralytics_font  # noqa: E402

ensure_ultralytics_font()

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "merged" / "data.yaml"
WEIGHTS_OUT = ROOT.parent / "backend" / "models" / "belt_v1.pt"


def resolve_device(preference: str) -> str:
    if preference != "auto":
        return preference
    try:
        import torch

        if torch.cuda.is_available():
            return "0"
        if torch.backends.mps.is_available():
            return "mps"
    except ImportError:
        pass
    return "cpu"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", default="yolo11s.pt",
                    help="base weights (yolo11n/s/m.pt)")
    ap.add_argument("--data", default=str(DATA))
    ap.add_argument("--epochs", type=int, default=120)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--name", default="belt_v1")
    ap.add_argument("--patience", type=int, default=30,
                    help="early-stopping patience in epochs")
    ap.add_argument("--no-install", action="store_true",
                    help="do not copy the best weights into backend/models/")
    args = ap.parse_args()

    if not Path(args.data).exists():
        sys.exit(f"No dataset at {args.data}.\n"
                 "Run training/download_dataset.py then training/merge_datasets.py.")

    try:
        from ultralytics import YOLO
    except ImportError:
        sys.exit("ultralytics is required: pip install ultralytics")

    device = resolve_device(args.device)
    print(f"Training {args.model} on {device} for {args.epochs} epochs "
          f"at {args.imgsz}px\n")

    model = YOLO(args.model)
    model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=device,
        project=str(ROOT / "runs"),
        name=args.name,
        patience=args.patience,
        exist_ok=True,
        # Domain-tuned augmentation.
        hsv_h=0.010,      # belt rubber is essentially hueless
        hsv_s=0.40,
        hsv_v=0.60,       # wide value jitter: lighting is the big variable
        degrees=3.0,      # a belt is near-axis-aligned; large rotations are lies
        translate=0.12,
        scale=0.45,
        shear=2.0,
        fliplr=0.5,
        flipud=0.0,       # never flip vertically: belts run one way
        mosaic=1.0,
        close_mosaic=15,  # disable mosaic for the final epochs to settle boxes
        erasing=0.25,     # simulates occlusion by ore on the belt
    )

    best = ROOT / "runs" / args.name / "weights" / "best.pt"
    if not best.exists():
        print(f"\n⚠ Expected weights at {best} but none were written.")
        return 1

    print(f"\n✓ Best weights: {best}")
    if not args.no_install:
        WEIGHTS_OUT.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(best, WEIGHTS_OUT)
        print(f"✓ Installed to {WEIGHTS_OUT}")
        print("\nTo use them: set DETECTOR=yolo in backend/.env and restart the "
              "backend.")

    print("\nEvaluate with: python training/evaluate.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
