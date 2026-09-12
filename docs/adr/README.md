# Architecture Decision Records

Why the load-bearing decisions were made the way they were — the ones where the
obvious choice was rejected, and where someone reading the code later would
otherwise reasonably "fix" it back.

An ADR here is not a design document. It records a decision that has already
been made, the alternative that was tried or seriously considered, and what
following the decision costs. If a choice has no plausible alternative, it does
not need a record; a comment in the code is enough.

| # | Decision | In short |
| --- | --- | --- |
| [0001](0001-one-deep-frame-slot.md) | Capture hands off through a one-deep slot, not a queue | A queue would turn a slow detector into batch processing at a growing delay. Dropping stale frames is what makes a video file an honest stand-in for a camera. |
| [0002](0002-joint-presence-is-not-an-incident.md) | A belt joint's presence is not an incident; rupture is a trained class | The joint passes the camera every revolution. A recurring structural feature is not an event. |
| [0003](0003-two-models-one-specialised.md) | Two models ship, and the demonstration one is deliberately narrow | `belt_v1` scores 95% on public data and finds almost nothing on the prototype rig. Domain shift, not tuning. |
| [0004](0004-split-datasets-by-time.md) | Datasets are split by time, never at random | Adjacent video frames are the same picture, so a random split validates the model on data it trained on. |
| [0005](0005-local-labelling-tool.md) | Labelling happens in a local tool, not a hosted service | Datasets never leave the machine, and the workflow needs states a generic annotator does not distinguish. |
| [0006](0006-supabase-holds-the-history.md) | The incident history lives in Supabase, not on the API box's disk | The free hosting tier has no persistent disk; every spin-down erased the history the submission link pointed at. |
| [0007](0007-3d-model-runs-on-synthetic-telemetry.md) | The 3D Model tab ran on synthetic telemetry **(superseded)** | Kept because it explains why the tab is architecturally separate from the camera pipeline. The telemetry is now live ESP32 data. |
| [0008](0008-two-confidence-thresholds.md) | Detection and incident promotion get separate confidence thresholds | Early wear stays visible on the feed at 0.35 while the maintenance record keeps a stricter 0.50 bar. |
| [0009](0009-reliability-yield-counts-defects-not-sightings.md) | Reliability Yield counts distinct defects, not incident rows | A belt is a loop, so one tear opens a fresh incident every revolution. Counting rows measures belt speed as much as belt damage. |

## Reading order

0001 and 0002 explain the pipeline's shape and are worth reading before any
backend code. 0009 explains why the Analytics tab's numbers differ from the Live
Monitor's, which is the most common point of confusion in the dashboard.

0003, 0004 and 0005 are about training and matter only if you are retraining on
your own belt; start from [DATASETS.md](../DATASETS.md) in that case.

## Superseded records stay

[0007](0007-3d-model-runs-on-synthetic-telemetry.md) describes behaviour the
code no longer has. It is kept rather than deleted because the decision it
records — that the 3D Model tab is a separate instrument from the camera
pipeline, with its own data source and its own visual identity — survived the
change and still constrains the code. A record is removed only when the
constraint it documents is genuinely gone, and then the removal is itself a
decision worth a record.

## Adding one

One file, `NNNN-a-sentence-naming-the-decision.md`, numbered in sequence. Open
with the decision as a statement of fact in the present tense, then the
alternative and why it lost, then what this costs. Add the row above — an index
nobody updates is worse than no index.
