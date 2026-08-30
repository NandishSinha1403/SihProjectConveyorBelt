"""Install a manually downloaded dataset into training/data/raw/.

Roboflow's SDK is convenient but optional. Any YOLO-format dataset works --
Kaggle, a GitHub repo, a Roboflow "Download zip" from the browser, or your own
labelled footage. Point this at a zip or a folder and it lands where
merge_datasets.py expects it.

    python training/import_dataset.py ~/Downloads/belt-damage.zip
    python training/import_dataset.py ~/Downloads/belt-damage.zip --name my-belt
    python training/import_dataset.py ~/my-labelled-frames/

Expected structure (either layout is fine):

    data.yaml
    train/images/*.jpg   train/labels/*.txt
    valid/images/*.jpg   valid/labels/*.txt

If there is no data.yaml, one is generated from --classes so datasets exported
without it can still be used.
"""
from __future__ import annotations

import argparse
import shutil
import sys
import zipfile
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "data" / "raw"


def find_dataset_root(base: Path) -> Path:
    """Locate the real dataset root.

    Archives frequently wrap everything in a single top-level folder, so the
    data.yaml (or the train/ directory) can be one or two levels down.
    """
    if (base / "data.yaml").exists() or (base / "train").is_dir():
        return base
    for candidate in sorted(p for p in base.rglob("data.yaml")):
        return candidate.parent
    for candidate in sorted(p for p in base.rglob("train") if p.is_dir()):
        if (candidate / "images").is_dir():
            return candidate.parent
    return base


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="path to a .zip archive or a dataset folder")
    ap.add_argument("--name", help="folder name under data/raw (default: derived)")
    ap.add_argument("--classes", nargs="*",
                    help="class names in index order, if the dataset has no data.yaml")
    ap.add_argument("--force", action="store_true", help="overwrite an existing import")
    args = ap.parse_args()

    source = Path(args.source).expanduser().resolve()
    if not source.exists():
        sys.exit(f"Not found: {source}")

    name = args.name or source.stem.replace(" ", "_").lower()
    target = RAW_DIR / name

    if target.exists():
        if not args.force:
            sys.exit(f"{target} already exists. Pass --force to replace it.")
        shutil.rmtree(target)

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    staging = RAW_DIR / f".{name}.staging"
    if staging.exists():
        shutil.rmtree(staging)

    try:
        if source.is_file() and source.suffix.lower() == ".zip":
            print(f"Extracting {source.name}…")
            with zipfile.ZipFile(source) as zf:
                # Refuse absolute paths and traversal entries before extracting.
                for member in zf.namelist():
                    resolved = (staging / member).resolve()
                    if not str(resolved).startswith(str(staging.resolve())):
                        sys.exit(f"Refusing unsafe archive entry: {member}")
                zf.extractall(staging)
        elif source.is_dir():
            print(f"Copying {source}…")
            shutil.copytree(source, staging)
        else:
            sys.exit("Source must be a .zip file or a directory")

        root = find_dataset_root(staging)
        shutil.move(str(root), str(target))
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)

    data_yaml = target / "data.yaml"
    if not data_yaml.exists():
        if not args.classes:
            sys.exit(
                f"{target} has no data.yaml and --classes was not given.\n"
                "Re-run with the class names in index order, e.g.\n"
                f"  python training/import_dataset.py {args.source} "
                "--classes tear hole scratch"
            )
        data_yaml.write_text(yaml.safe_dump({
            "train": "train/images",
            "val": "valid/images",
            "nc": len(args.classes),
            "names": list(args.classes),
        }, sort_keys=False))
        print(f"Generated data.yaml with classes: {', '.join(args.classes)}")

    cfg = yaml.safe_load(data_yaml.read_text())
    names = cfg.get("names", [])
    if isinstance(names, dict):
        names = [names[k] for k in sorted(names, key=int)]

    counts = {}
    for split in ("train", "valid", "test"):
        for images in (target / split / "images", target / "images" / split):
            if images.is_dir():
                counts[split] = sum(1 for _ in images.iterdir())
                break

    print(f"\n✓ Imported to {target}")
    print(f"  Classes: {', '.join(map(str, names)) or '(none listed)'}")
    print(f"  Images:  {counts or '(none found — check the folder layout)'}")
    print("\nNext: python training/merge_datasets.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
