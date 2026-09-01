"""The unified defect vocabulary and the alias map onto it.

Public conveyor-belt datasets label the same physical defect half a dozen
different ways -- "Large Tear", "rip", "longitudinal_tear", "tear-belt". Rather
than teaching the runtime every dialect, every dataset is remapped onto these
six canonical names at merge time, so the model, the API and the dashboard only
ever speak one vocabulary.

Keep this in step with backend/app/pipeline/types.py::CLASS_NAMES.
"""
from __future__ import annotations

CLASS_NAMES: list[str] = [
    "tear",
    "hole",
    "scratch",
    "crack",
    "belt_joint",
    "joint_damage",
]

# Source label (lowercased, punctuation-normalised) -> canonical class.
# Anything not listed here is reported by merge_datasets.py so unmapped labels
# are a visible decision rather than a silent drop.
ALIASES: dict[str, str] = {
    # tear / rip
    "tear": "tear",
    "tears": "tear",
    "large tear": "tear",
    "small tear": "tear",
    "rip": "tear",
    "ripped": "tear",
    "longitudinal tear": "tear",
    "belt tear": "tear",
    "torn": "tear",
    "damage": "tear",
    # hole / puncture
    "hole": "hole",
    "holes": "hole",
    "large hole": "hole",
    "small hole": "hole",
    "puncture": "hole",
    "perforation": "hole",
    "gouge": "hole",
    "impact damage": "hole",   # impact gouging penetrates the cover, like a puncture
    # scratch / abrasion
    "scratch": "scratch",
    "scratches": "scratch",
    "scuff": "scratch",
    "abrasion": "scratch",
    "wear": "scratch",
    "surface wear": "scratch",
    # crack
    "crack": "crack",
    "cracks": "crack",
    "cracking": "crack",
    "fissure": "crack",
    "split": "crack",
    # joints
    "belt joint": "belt_joint",
    "joint": "belt_joint",
    "splice": "belt_joint",
    "seam": "belt_joint",
    "belt splice": "belt_joint",
    "fastener": "belt_joint",
    "clip": "belt_joint",
    # damaged joints
    "joint damage": "joint_damage",
    "damaged joint": "joint_damage",
    "broken joint": "joint_damage",
    "joint failure": "joint_damage",
    "splice failure": "joint_damage",
    "damaged splice": "joint_damage",
    # The rig dataset labels this by what it looks like -- a splice that has
    # separated at the belt edge into an open wedge. These are the names most
    # likely to be typed into Roboflow for it.
    "joint rupture": "joint_damage",
    "belt joint rupture": "joint_damage",
    "rupture": "joint_damage",
    "ruptured joint": "joint_damage",
    "separated joint": "joint_damage",
    "open joint": "joint_damage",
    "split joint": "joint_damage",
}


def normalise(label: str) -> str:
    """Reduce a source label to the form used as an ALIASES key."""
    return (
        label.strip()
        .lower()
        .replace("_", " ")
        .replace("-", " ")
        .replace("/", " ")
        .replace(".", " ")
        .strip()
    )


def canonical(label: str) -> str | None:
    """Map a source label onto a canonical class, or None if unrecognised."""
    key = normalise(label)
    if key in ALIASES:
        return ALIASES[key]
    # Fall back to a containment check: "conveyor belt tear v2" -> tear.
    for alias, target in ALIASES.items():
        if alias in key:
            return target
    return None
