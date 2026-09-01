"""Turn the rig footage in assets/ into a set of frames to label in Roboflow.

    python training/extract_frames.py --dry-run     # report, write nothing
    python training/extract_frames.py               # write training/data/rig_frames/

Not an ffmpeg dump. At 30 fps consecutive frames are near-identical, so dumping
every frame both wastes labelling effort and destroys the train/val split --
frame 100 and frame 101 of the same clip are the same picture, and putting one in
each half makes the validation score meaningless. This samples sparsely, throws
away the frames too motion-blurred to label honestly, and de-duplicates whatever
survives.

Three properties of this particular footage are handled explicitly, because each
one silently corrupts a training run if it is not:

* ``WhatsApp …5.52.37 PM.mp4`` is entirely contained in the longer clideo video
  (measured: 100% of its sampled frames match at >0.99 cosine). Keeping both puts
  near-duplicates on both sides of the split.
* ``WhatsApp …5.52.36 PM.mp4`` is smeared beyond use -- median Laplacian variance
  3.5 against 68 for the others.
* ``Movie …6.43 PM.mov`` is the held-out field test. It must never be labelled or
  trained on, or the one honest end-to-end number is gone.

Filenames here contain U+202F (narrow no-break space) before "PM", which OpenCV
fails to open when the path is written out literally. Everything is enumerated
through os.listdir and the emitted frames get ASCII-safe names.
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
ASSETS = ROOT.parent / "assets"
OUT_DIR = ROOT / "data" / "rig_frames"

# Per-source policy, matched on a substring of the filename so the U+202F in the
# real names never has to be written down. `weight` scales the sampling rate:
# the demo is the roller close-up, so wide and badly-framed footage contributes
# proportionally fewer frames rather than being dropped outright.
SOURCES: list[dict] = [
    {
        "match": "6.07",
        "tag": "m607",
        "weight": 1.0,
        "note": "handheld walkthrough - full rig and roller, belt running",
    },
    {
        "match": "55237",           # the clideo re-encode, not the WhatsApp original
        "tag": "clideo",
        "weight": 1.0,
        "note": "roller close-up, belt running (watermarked bottom-right)",
    },
    {
        "match": "6.05",
        "tag": "m605",
        "weight": 0.4,
        "note": "shaky handheld, often poorly framed",
    },
]

# Excluded, with the reason recorded so a future reader does not re-add them.
EXCLUDED: list[dict] = [
    {
        "match": "5.52.37",
        "reason": "duplicate - 100% of its frames appear in the clideo video",
    },
    {
        "match": "5.52.36",
        "reason": "motion-smeared - median Laplacian variance 3.5 vs 68",
    },
]

# Never extracted: this is the held-out field test.
HELD_OUT = {"match": "6.43", "reason": "held-out field test video"}

# Below this centre-crop Laplacian variance a frame is too smeared to label.
# Deliberately low: no rig footage exceeds 200, and the live feed is blurred
# too, so moderately blurred frames are training signal rather than noise.
BLUR_FLOOR = 20.0

# Cosine similarity above which two frames count as the same picture.
DUPLICATE_SIMILARITY = 0.995

# Sampling rate before per-source weighting. 6 lands ~360 frames across this
# footage, which is the point where de-duplication starts rejecting frames --
# i.e. roughly where extra sampling stops buying distinct pictures and starts
# buying labelling work.
SAMPLE_FPS = 6.0


def find_videos() -> list[Path]:
    """All videos under assets/, enumerated safely despite U+202F in names."""
    out: list[Path] = []
    for path in sorted(ASSETS.rglob("*")):
        if path.is_file() and path.suffix.lower() in (".mov", ".mp4", ".m4v", ".avi"):
            out.append(path)
    return out


def classify(path: Path) -> tuple[str, dict | None]:
    """Return (disposition, spec) for one video."""
    name = path.name
    if HELD_OUT["match"] in name:
        return "held-out", HELD_OUT
    for spec in EXCLUDED:
        if spec["match"] in name:
            return "excluded", spec
    for spec in SOURCES:
        if spec["match"] in name:
            return "use", spec
    return "unknown", None


def sharpness(image: np.ndarray) -> float:
    """Laplacian variance over the centre of the frame, where the belt is.

    Cropping matters: the background is a cluttered desk that stays sharp even
    when the belt is smeared, so a whole-frame measure would rate an unusable
    frame as fine.
    """
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    h, w = grey.shape
    crop = grey[int(h * 0.15):int(h * 0.85), int(w * 0.15):int(w * 0.85)]
    return float(cv2.Laplacian(crop, cv2.CV_64F).var())


def signature(image: np.ndarray) -> np.ndarray:
    """Small mean-centred, unit-length descriptor for near-duplicate detection."""
    small = cv2.resize(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), (32, 32))
    vec = small.astype(np.float32).ravel()
    vec -= vec.mean()
    norm = np.linalg.norm(vec)
    return vec / norm if norm > 1e-6 else vec


def ascii_name(text: str) -> str:
    """Fold a filename to something every tool on the path can open."""
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in folded)


def harvest(path: Path, spec: dict, sample_fps: float, blur_floor: float,
            kept_signatures: list[np.ndarray]) -> list[dict]:
    """Sample one video, returning the frames worth labelling."""
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        print(f"  x could not open {path.name}", file=sys.stderr)
        return []

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    stride = max(1, int(round(src_fps / (sample_fps * spec["weight"]))))

    rows: list[dict] = []
    blurred = duplicates = 0
    index = 0
    while True:
        ok, image = cap.read()
        if not ok:
            break
        if index % stride == 0:
            score = sharpness(image)
            if score < blur_floor:
                blurred += 1
            else:
                sig = signature(image)
                if kept_signatures and max(
                        float(sig @ other) for other in kept_signatures
                ) > DUPLICATE_SIMILARITY:
                    duplicates += 1
                else:
                    kept_signatures.append(sig)
                    rows.append({
                        "name": f"rig_{spec['tag']}_{index:05d}.jpg",
                        "source": path.name,
                        "frame_index": index,
                        "timestamp_s": round(index / src_fps, 2),
                        "sharpness": round(score, 1),
                        "image": image,
                    })
        index += 1
    cap.release()

    print(f"  {path.name[:46]:48} {len(rows):4} kept "
          f"(every {stride} of {total}; {blurred} blurred, {duplicates} duplicate)")
    return rows


def harvest_stills(kept_signatures: list[np.ndarray]) -> list[dict]:
    """The 40 photos, renamed to ASCII so Roboflow and OpenCV both cope."""
    folder = next((p for p in ASSETS.iterdir()
                   if p.is_dir() and p.name.strip() == "all picture"), None)
    if folder is None:
        print("  ! no 'all picture' folder found; skipping stills")
        return []

    rows: list[dict] = []
    for i, path in enumerate(sorted(p for p in folder.iterdir()
                                    if p.suffix.lower() in (".jpg", ".jpeg", ".png"))):
        image = cv2.imread(str(path))
        if image is None:
            continue
        kept_signatures.append(signature(image))
        rows.append({
            "name": f"rig_still_{i:03d}.jpg",
            "source": ascii_name(path.name),
            "frame_index": -1,
            "timestamp_s": 0.0,
            "sharpness": round(sharpness(image), 1),
            "image": image,
        })
    print(f"  {'stills (assets/all picture/)':48} {len(rows):4} kept")
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(OUT_DIR))
    ap.add_argument("--fps", type=float, default=SAMPLE_FPS,
                    help="frames sampled per second of footage (before weighting)")
    ap.add_argument("--blur-floor", type=float, default=BLUR_FLOOR,
                    help="minimum centre-crop Laplacian variance to keep a frame")
    ap.add_argument("--no-stills", action="store_true",
                    help="skip the 40 photos in assets/all picture/")
    ap.add_argument("--include-all", action="store_true",
                    help="also extract the excluded and held-out videos "
                         "(will corrupt the split -- for inspection only)")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be written, write nothing")
    args = ap.parse_args()

    if not ASSETS.exists():
        sys.exit(f"No assets directory at {ASSETS}")

    videos = find_videos()
    if not videos:
        sys.exit(f"No videos found under {ASSETS}")

    print(f"Scanning {len(videos)} videos in {ASSETS}\n")

    plan: list[tuple[Path, dict]] = []
    for path in videos:
        disposition, spec = classify(path)
        if disposition == "use":
            plan.append((path, spec))
        elif args.include_all and spec is not None:
            print(f"  ! including {path.name[:40]} anyway ({spec['reason']})")
            plan.append((path, {**spec, "tag": ascii_name(path.stem)[:12],
                                "weight": 1.0}))
        elif disposition == "unknown":
            print(f"  ? {path.name[:46]:48} not in SOURCES -- skipped")
        else:
            print(f"  - {path.name[:46]:48} {disposition}: {spec['reason']}")

    if not plan:
        sys.exit("\nNothing to extract.")

    print("\nSampling:")
    kept_signatures: list[np.ndarray] = []
    rows: list[dict] = []
    for path, spec in plan:
        rows.extend(harvest(path, spec, args.fps, args.blur_floor, kept_signatures))

    if not args.no_stills:
        rows.extend(harvest_stills(kept_signatures))

    print(f"\n{len(rows)} images to label.")

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return 0

    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    for row in rows:
        cv2.imwrite(str(out / row["name"]), row.pop("image"),
                    [int(cv2.IMWRITE_JPEG_QUALITY), 95])

    with (out / "manifest.csv").open("w", newline="") as fh:
        writer = csv.DictWriter(
            fh, fieldnames=["name", "source", "frame_index", "timestamp_s",
                            "sharpness"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n+ {len(rows)} frames -> {out}")
    print(f"+ manifest -> {out / 'manifest.csv'}")
    print("\nNext: upload this folder to Roboflow and label "
          "tear / hole / joint_damage.")
    print("Assign the split by hand -- a random split puts consecutive frames of "
          "the same clip on both sides.")
    print("\nNote: rig_m607_* frames cover two camera views -- the roller "
          "close-up and a wider shot of the whole rig. The demo is the roller "
          "view, so delete the wide ones in Roboflow before labelling if you "
          "want the model concentrated on it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
