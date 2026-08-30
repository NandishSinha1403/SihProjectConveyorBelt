"""Environment fixes applied before Ultralytics is used.

Import this at the top of any training entry point.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

# Any TrueType face works -- Ultralytics only needs *a* font to annotate plots.
_MACOS_FALLBACK_FONTS = [
    Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    Path("/Library/Fonts/Arial.ttf"),
    Path("/System/Library/Fonts/Helvetica.ttc"),
    Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
]


def ensure_ultralytics_font() -> None:
    """Pre-seed Ultralytics' font cache so it never enumerates system fonts.

    Ultralytics calls ``check_font()`` while validating a dataset, which calls
    ``matplotlib.font_manager.findSystemFonts()``. On macOS that shells out to
    ``system_profiler SPFontsDataType -json`` and reads ``d["_items"]``. On
    macOS 26 that key is absent, so the call raises KeyError and training dies
    before the first epoch:

        File ".../matplotlib/font_manager.py", line 272, in _get_macos_fonts
            return [Path(entry["path"]) for entry in d["_items"]]
        KeyError: '_items'

    ``check_font`` returns early if the font already exists in Ultralytics'
    config directory, so placing one there sidesteps the crash entirely. It also
    avoids the call being slow -- ``system_profiler`` can take minutes.

    Safe to call on any platform: it does nothing when the font is already
    cached or when no source font is found.
    """
    try:
        from ultralytics.utils import USER_CONFIG_DIR
    except ImportError:
        return

    target = Path(USER_CONFIG_DIR) / "Arial.ttf"
    if target.exists():
        return

    for candidate in _MACOS_FALLBACK_FONTS:
        if candidate.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            # copyfile, not copy2: system fonts carry SIP flags that copystat
            # cannot reproduce, and only the bytes matter here.
            shutil.copyfile(candidate, target)
            print(f"Seeded Ultralytics font cache from {candidate.name} "
                  f"(works around matplotlib font enumeration on macOS)")
            return

    if sys.platform == "darwin":
        print("⚠ Could not find a system font to seed the Ultralytics font "
              "cache. If training fails with KeyError: '_items', copy any .ttf "
              f"to {target}")
