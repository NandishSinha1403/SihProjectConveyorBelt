# Training Data

## Datasets in use

Both are published on Roboflow Universe under **CC BY 4.0**, which permits
commercial and non-commercial use with attribution. Attribution is given below
and must be retained in any presentation or publication of this work.

| Dataset | Source | Images | License |
| --- | --- | --- | --- |
| `conveyor-belt-damage` | Roboflow Universe — workspace `sample-wy2mp` | 922 | CC BY 4.0 |
| `conveyor-belt-damage-ucjlj` | Roboflow Universe — workspace `test-yfiry` | 651 | CC BY 4.0 |

Retrieve them with:

```bash
python training/download_dataset.py
python training/merge_datasets.py
```

A Roboflow account is needed for the API key. The **free Public plan** covers
downloading public Universe datasets; the paid tiers only matter if you want
*your own* uploads kept private. Note that anything you upload on the free plan
becomes public — so label your own belt footage locally rather than pushing it
there.

If you would rather not create an account at all, download any YOLO-format
dataset by hand and install it with:

```bash
python training/import_dataset.py ~/Downloads/some-belt-dataset.zip
```

## Class mapping

Publishers name the same defect differently. `training/classes.py` maps every
variant onto one vocabulary; anything unrecognised is **reported, not silently
dropped**.

| Source labels | Canonical class |
| --- | --- |
| Tear, Large Tear, Small Tear, rip | `tear` |
| Hole, Large Hole, Small Hole, Puncture, impact damage | `hole` |
| Belt Joint, splice, seam, fastener | `belt_joint` |
| Scratch, abrasion, wear | `scratch` |
| Crack, fissure | `crack` |

## What the current data actually supports

After merging, **2,844 annotations across 1,573 images**:

| Class | Instances | Share |
| --- | --- | --- |
| `tear` | 1,455 | 51.2% |
| `hole` | 1,308 | 46.0% |
| `belt_joint` | 81 | 2.8% |

Two things follow, and both are worth stating plainly rather than papering over:

**1. Only three classes are trained.** `scratch`, `crack` and `joint_damage`
have zero examples in the public data, so `merge_datasets.py` **excludes them
from the emitted dataset**. A model advertising a class it was never shown
cannot predict it, and a dead class in the API and dashboard looks like a
capability the system does not have.

`joint_damage` is the deliberate exception: it is *derived at runtime*, not
trained. `app/pipeline/events.py` promotes a detected `belt_joint` to
`joint_damage` when a tear or hole sits substantially inside it. That is a
genuine inference from two trained classes, not a placeholder.

To get `scratch` and `crack`, label them yourself — a few hundred frames from
your own belt footage is enough to add a class, and `import_dataset.py` will
fold them into the same pipeline.

**2. `belt_joint` is heavily under-represented** at 18:1 against `tear`. Since
joint rupture is the headline of the problem statement, this is the single most
valuable gap to close. Options, cheapest first:

- Label joints in your own recordings — joints recur every belt revolution, so a
  few minutes of footage yields many instances.
- Oversample the joint images by duplicating them in the merged train split.
- Weight the classification loss toward the rare class.

`merge_datasets.py` prints the imbalance ratio on every run so this stays
visible rather than surfacing later as a mysteriously poor per-class mAP.

## Unmapped labels in the source data

These appear in the public datasets and are currently skipped. Several are
genuinely useful and worth reconsidering:

| Label | Why it was skipped | Worth adding? |
| --- | --- | --- |
| `Human` | Not a belt defect | **Yes, eventually** — a person near a running belt is a safety event, and the problem statement explicitly lists safety risk |
| `Other Objects` | Not a belt defect | **Yes** — tramp metal and foreign objects are a leading *cause* of longitudinal tears |
| `Roller` | Structural, not belt surface | Useful for idler-failure detection later |
| `patch work` | A previous repair, not active damage | Useful as a maintenance-history signal |

Adding any of these is a one-line entry in `training/classes.py::ALIASES` plus a
retrain.

## Attribution

> Conveyor belt damage datasets sourced from Roboflow Universe
> (`sample-wy2mp/conveyor-belt-damage` and `test-yfiry/conveyor-belt-damage-ucjlj`),
> used under the Creative Commons Attribution 4.0 International License
> (CC BY 4.0). <https://creativecommons.org/licenses/by/4.0/>
