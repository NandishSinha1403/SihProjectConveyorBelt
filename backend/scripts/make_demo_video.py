"""Assemble real belt imagery into a video for demonstrating the trained model.

The synthetic clip from make_sample_video.py exists to exercise the streaming
pipeline before a model is trained -- it is procedural noise, and a model
trained on real belt rubber correctly detects nothing in it.

This builds a clip from the actual dataset frames instead, so the detector has
something real to work on. Each source image is held for a moment and panned
slightly, which also gives the tracker consecutive frames to work with so
incidents confirm the way they would on a live feed.

These are real photographs of real conveyor belts (Roboflow Universe,
CC BY 4.0) -- not synthesised. They are not, however, *your* belt: use them to
prove the system works, then record your own footage for anything that has to
represent your site.

    python scripts/make_demo_video.py
    python scripts/make_demo_video.py --seconds 90 --hold 2.5
"""
from __future__ import annotations

import argparse
import random
from pathlib import Path

import cv2
import numpy as np

BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
DATASET = BASE_DIR.parent / "training" / "data" / "merged"


def load_frames(limit: int) -> list[Path]:
    """Prefer validation images: the model was not trained on them."""
    candidates: list[Path] = []
    for split in ("valid", "train"):
        d = DATASET / split / "images"
        if d.is_dir():
            candidates.extend(sorted(d.glob("*.jpg")) + sorted(d.glob("*.png")))
        if candidates:
            break
    if not candidates:
        raise SystemExit(
            f"No dataset images under {DATASET}.\n"
            "Run: python training/download_dataset.py && python training/merge_datasets.py"
        )
    rng = random.Random(20)
    rng.shuffle(candidates)
    return candidates[:limit]


def fit(image: np.ndarray, width: int, height: int) -> np.ndarray:
    """Letterbox onto the output canvas without distorting the belt."""
    h, w = image.shape[:2]
    scale = max(width / w, height / h)          # fill, then crop
    resized = cv2.resize(image, (int(w * scale) + 1, int(h * scale) + 1))
    y = (resized.shape[0] - height) // 2
    x = (resized.shape[1] - width) // 2
    return resized[y:y + height, x:x + width]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="media/uploads/demo_belt_real.mp4")
    ap.add_argument("--seconds", type=float, default=60.0)
    ap.add_argument("--fps", type=float, default=25.0)
    ap.add_argument("--width", type=int, default=960)
    ap.add_argument("--height", type=int, default=540)
    ap.add_argument("--hold", type=float, default=2.0,
                    help="seconds to dwell on each source image")
    args = ap.parse_args()

    out_path = BASE_DIR / args.out if not Path(args.out).is_absolute() else Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    frames_per_image = max(1, int(args.hold * args.fps))
    n_images = max(1, int(args.seconds * args.fps / frames_per_image))
    sources = load_frames(n_images)

    writer = cv2.VideoWriter(str(out_path), cv2.VideoWriter_fourcc(*"avc1"),
                             args.fps, (args.width, args.height))
    if not writer.isOpened():
        raise SystemExit(f"Could not open a video writer for {out_path}")

    written = 0
    for path in sources:
        image = cv2.imread(str(path))
        if image is None:
            continue
        # Oversize slightly so a slow pan has somewhere to move, which keeps the
        # tracker fed with genuinely consecutive, slightly-different frames.
        canvas = fit(image, int(args.width * 1.10), int(args.height * 1.10))
        max_dx = canvas.shape[1] - args.width
        max_dy = canvas.shape[0] - args.height

        for i in range(frames_per_image):
            t = i / max(1, frames_per_image - 1)
            x = int(t * max_dx)
            y = int(t * max_dy * 0.5)
            writer.write(canvas[y:y + args.height, x:x + args.width])
            written += 1

    writer.release()
    if written == 0:
        raise SystemExit("No frames were written — no readable source images.")

    size_mb = out_path.stat().st_size / 1e6
    print(f"Wrote {out_path}")
    print(f"  {written} frames · {written / args.fps:.0f}s @ {args.fps:g} fps · "
          f"{args.width}x{args.height} · {size_mb:.1f} MB")
    print(f"  built from {len(sources)} real belt photographs "
          f"(Roboflow Universe, CC BY 4.0)")


if __name__ == "__main__":
    main()
