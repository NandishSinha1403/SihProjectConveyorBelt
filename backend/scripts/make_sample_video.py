"""Generate a synthetic conveyor belt video for end-to-end testing.

This is a test fixture, not training data: it produces a dark, grainy, scrolling
rubber-belt surface with tears, holes, scratches and a periodic splice joint, in
roughly the visual register of the underground imagery in Guo et al. Figure 9.

It exists so the streaming pipeline, dashboard and incident engine can be
exercised before any real belt footage is recorded.

    python scripts/make_sample_video.py --seconds 60 --out media/uploads/sample_belt.mp4
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

import cv2
import numpy as np

RNG = np.random.default_rng(11)


def belt_texture(width: int, height: int) -> np.ndarray:
    """A tall, tileable strip of grainy rubber with longitudinal grain."""
    base = RNG.normal(58, 9, (height, width)).astype(np.float32)
    base = cv2.GaussianBlur(base, (0, 0), 1.4)

    # Faint vertical grain, as moulded belt rubber has.
    grain = np.sin(np.linspace(0, 90 * math.pi, width))[None, :] * 3.0
    base += grain

    # A few long-lived surface streaks so the belt is not uniform.
    for _ in range(14):
        x = int(RNG.integers(0, width))
        w = int(RNG.integers(2, 7))
        base[:, x:x + w] += RNG.normal(0, 6)

    return np.clip(base, 0, 255).astype(np.uint8)


def draw_tear(img, x, y, length, width_px):
    """A long, narrow, dark longitudinal rip with ragged edges."""
    pts = []
    for t in np.linspace(0, 1, 24):
        pts.append((int(x + RNG.normal(0, width_px * 0.5)), int(y + t * length)))
    for i in range(len(pts) - 1):
        cv2.line(img, pts[i], pts[i + 1], int(RNG.integers(8, 20)),
                 max(1, int(width_px)), cv2.LINE_AA)
    # Lifted rubber lips catch the light on either side of the rip.
    cv2.line(img, (pts[0][0] - width_px, pts[0][1]),
             (pts[-1][0] - width_px, pts[-1][1]), 105, 1, cv2.LINE_AA)


def draw_hole(img, x, y, r):
    cv2.circle(img, (x, y), r, 12, -1, cv2.LINE_AA)
    cv2.circle(img, (x, y), r, 96, 2, cv2.LINE_AA)
    for _ in range(9):  # frayed carcass fibres around the puncture
        a = RNG.uniform(0, 2 * math.pi)
        rr = r * RNG.uniform(1.0, 1.5)
        cv2.line(img, (x, y), (int(x + rr * math.cos(a)), int(y + rr * math.sin(a))),
                 int(RNG.integers(70, 130)), 1, cv2.LINE_AA)


def draw_scratch(img, x, y, w, h):
    for _ in range(RNG.integers(4, 9)):
        x0 = int(x + RNG.uniform(0, w))
        y0 = int(y + RNG.uniform(0, h))
        cv2.line(img, (x0, y0), (x0 + int(RNG.normal(0, 9)), y0 + int(RNG.uniform(6, 22))),
                 int(RNG.integers(95, 145)), 1, cv2.LINE_AA)


def draw_crack(img, x, y, size):
    px, py = x, y
    for _ in range(int(size / 4)):
        nx = px + int(RNG.normal(0, 4))
        ny = py + int(RNG.uniform(2, 6))
        cv2.line(img, (px, py), (nx, ny), 18, 2, cv2.LINE_AA)
        px, py = nx, ny


def draw_joint(img, y, width, damaged: bool):
    """A mechanical splice: a lateral band of fastener clips across the belt."""
    cv2.rectangle(img, (0, y - 16), (width, y + 16), 44, -1)
    for x in range(12, width - 12, 26):
        cv2.rectangle(img, (x, y - 11), (x + 15, y + 11), 128, -1)
        cv2.rectangle(img, (x, y - 11), (x + 15, y + 11), 70, 1)
    if damaged:
        # A crack running out of the splice: the failure this project targets.
        draw_crack(img, width // 2, y + 12, 70)
        cv2.rectangle(img, (width // 2 - 40, y - 14), (width // 2 + 40, y + 14), 20, -1)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="media/uploads/sample_belt.mp4")
    ap.add_argument("--seconds", type=float, default=60.0)
    ap.add_argument("--fps", type=float, default=25.0)
    ap.add_argument("--width", type=int, default=960)
    ap.add_argument("--height", type=int, default=540)
    ap.add_argument("--speed", type=float, default=260.0,
                    help="belt speed in pixels per second")
    args = ap.parse_args()

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # The belt is one tall strip scrolled through the viewport, so defects
    # genuinely recur once per belt revolution -- which is what the deferred
    # digital-twin belt map will key on.
    strip_h = args.height * 6
    strip = belt_texture(args.width, strip_h)

    draw_tear(strip, int(args.width * 0.55), int(strip_h * 0.05), 260, 4)
    draw_tear(strip, int(args.width * 0.30), int(strip_h * 0.62), 150, 3)
    draw_hole(strip, int(args.width * 0.72), int(strip_h * 0.34), 22)
    draw_hole(strip, int(args.width * 0.20), int(strip_h * 0.80), 14)
    draw_scratch(strip, int(args.width * 0.15), int(strip_h * 0.20), 130, 60)
    draw_scratch(strip, int(args.width * 0.60), int(strip_h * 0.72), 90, 50)
    draw_crack(strip, int(args.width * 0.45), int(strip_h * 0.47), 90)
    draw_joint(strip, int(strip_h * 0.25), args.width, damaged=False)
    draw_joint(strip, int(strip_h * 0.88), args.width, damaged=True)

    fourcc = cv2.VideoWriter_fourcc(*"avc1")
    writer = cv2.VideoWriter(str(out_path), fourcc, args.fps,
                             (args.width, args.height))
    if not writer.isOpened():
        raise SystemExit(f"Could not open video writer for {out_path}")

    total = int(args.seconds * args.fps)
    for i in range(total):
        offset = int((i / args.fps) * args.speed) % strip_h
        view = np.take(strip, range(offset, offset + args.height),
                       axis=0, mode="wrap")

        frame = cv2.cvtColor(view, cv2.COLOR_GRAY2BGR)

        # Uneven overhead lighting, the way a single lamp over the belt behaves.
        yy, xx = np.mgrid[0:args.height, 0:args.width]
        vign = 1.0 - 0.45 * (((xx - args.width / 2) / (args.width / 2)) ** 2
                             + ((yy - args.height / 2) / (args.height / 2)) ** 2)
        frame = np.clip(frame * vign[..., None], 0, 255).astype(np.uint8)

        # Airborne dust: a few out-of-focus motes drifting through the beam.
        if RNG.random() < 0.5:
            for _ in range(int(RNG.integers(2, 7))):
                cv2.circle(frame,
                           (int(RNG.integers(0, args.width)),
                            int(RNG.integers(0, args.height))),
                           int(RNG.integers(1, 4)),
                           (int(RNG.integers(120, 200)),) * 3, -1, cv2.LINE_AA)

        # Sensor noise, spatially correlated. Pure per-pixel noise is both
        # unrealistic for a real sensor and effectively incompressible, which
        # would bloat the fixture to hundreds of megabytes.
        noise = cv2.GaussianBlur(
            RNG.normal(0, 5.0, (args.height, args.width)).astype(np.float32),
            (0, 0), 0.8)
        frame = np.clip(frame.astype(np.float32) + noise[..., None],
                        0, 255).astype(np.uint8)

        writer.write(frame)

    writer.release()
    size_mb = out_path.stat().st_size / 1e6
    print(f"Wrote {out_path} — {total} frames, {args.seconds:.0f}s @ {args.fps:g} fps, "
          f"{args.width}x{args.height}, {size_mb:.1f} MB")


if __name__ == "__main__":
    main()
