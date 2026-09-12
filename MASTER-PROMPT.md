# MASTER PROMPT — Build the C.A.R.R.Y. book

## Part A — Instructions to Claude

### What to build

Produce **one self-contained file, `carry-book.html`**, at the repository root.
It is a book that will be read on screen and printed to PDF (Chrome → Cmd+P →
Save as PDF). No build step, no external assets other than Google Fonts.

**Target length: about 15 printed A4 pages**, and at most 20. The content below
is already sized for this. Typeset it; do not expand it, and do not cut it to
hit a number — if it lands at 18 pages, that is fine. Every line below earns its
place; none of it is padding.

### The one rule that matters

**Every fact, number, file path and claim in the book comes from Part B of this
file.** You are the typesetter and the editor of presentation, not the author
of content.

- Do **not** invent statistics, dates, benchmarks or citations.
- Do **not** add chapters, examples or "further reading" that are not below.
- Do **not** pad a section that reads short. Several sections are deliberately
  short because the honest answer is short.
- You **may** rewrite a sentence for flow, split a paragraph, turn a list into
  a table, and choose where a callout box begins and ends. That is the whole
  of your creative licence.
- If something below is ambiguous, keep the ambiguity rather than resolving it
  with an invented detail.

### Typography

The reader asked for a **large, comfortable typeface**. Respect that.

| Role | Face | Size |
| --- | --- | --- |
| Body | EB Garamond | **12.5pt**, line-height **1.45** |
| Headings | Inter (600/700) | h1 24pt, h2 17pt, h3 13.5pt |
| Tables and the glossary | EB Garamond | 11.5pt, line-height 1.35 |
| Code, paths, inline identifiers | JetBrains Mono | 10.5pt |

12.5pt in a Garamond is a genuinely large, comfortable book size — Garamond runs
small for its nominal point size, so do not "correct" it downward. Tables and
the closing glossary are set a step smaller because they are scanned, not read.

- Measure: **68–72 characters**. Set a `max-width` on the text column in `ch`.
- Load fonts from `https://fonts.googleapis.com`; give every face a real
  fallback stack (`Georgia, serif` / `system-ui, sans-serif` /
  `ui-monospace, monospace`) so the book still reads offline.

### Page furniture

```css
@page { size: A4; margin: 22mm 20mm 20mm 20mm; }
```

- Title page: `C.A.R.R.Y.`, then *Conveyor Anomaly Recognition & Reliability
  Yield*, then *Team Unplayed — Institute of Technical Education and Research,
  Siksha 'O' Anusandhan University — Smart India Hackathon 2026*.
- A real table of contents with part and chapter numbering. Page numbers in the
  TOC are optional (they cannot be computed reliably in HTML); a clean numbered
  list is acceptable.
- `break-before: page` on every chapter `h2`; `break-inside: avoid` on tables,
  figures and callouts; `orphans: 3; widows: 3`.
- Running foot with the page number, centred, via `@page { @bottom-center }` if
  supported — degrade silently if not.

### Devices

Four callout box styles, each visually distinct (left rule + tinted ground, no
drop shadows):

- **Definition** — a term being introduced. Use these generously in Part II.
- **Why it matters** — connects theory to a decision actually taken here.
- **Likely question** — what an examiner is expected to ask, and the answer.
- **Honest caveat** — a limitation stated plainly.

Every set of numbers becomes a **table**. File paths are inline mono. Diagrams
are **inline SVG** — no image files, no diagramming library. Draw exactly these
five, and no others:

1. The end-to-end pipeline: camera → frame slot → detector → tracker → event
   engine → database → browser.
2. A bounding box with IoU shown as an overlap of two rectangles.
3. The train / validate / field-test split, drawn as three bars.
4. The confirmation state machine: *seen → pending (n<5) → confirmed → closed*.
5. The two-threshold band: 0.00 … 0.35 … 0.50 … 1.00 with the three regions
   labelled *ignored*, *drawn only*, *drawn and recorded*.

Keep SVG monochrome plus one accent colour. The book's palette: near-black ink
`#17181a` on warm paper `#faf9f7`, one accent `#b04a1f`, rules in `#dcdad5`.

### When done

Write the file, then tell the user in two lines: the path, and how to print it.
Do not summarise the book back to them.

---
## Part B — The book content

Everything from here down is the book. Typeset it.

---

# C.A.R.R.Y.
### Conveyor Anomaly Recognition & Reliability Yield
*Team Unplayed — Institute of Technical Education and Research,
Siksha 'O' Anusandhan University — Smart India Hackathon 2026*

> This book explains how the system was built, what the machine-learning
> vocabulary means, and where every piece of the code lives. It is written for
> someone who can program but has not trained a model before, and it is meant to
> be readable end to end in an evening before a viva.

---

## Part I — The problem

### 1. Why a torn conveyor belt is expensive

In an iron-ore handling plant, material moves on rubber conveyor belts that run
for hundreds of metres and never stop. A belt is a **loop**: it is a single
length of rubber whose two ends are joined, so every point on it passes any
fixed observer once per revolution.

Belts fail in a small number of characteristic ways. A **longitudinal tear**
opens along the direction of travel, usually when a sharp lump of ore or a piece
of tramp metal wedges under a skirt and drags. A **hole** is a puncture, often
where a tear has been running long enough to lose material. The **joint** — the
splice where the belt's ends meet — is the structurally weakest metre of the
belt, and when it begins to open the belt is minutes from parting.

The cost is not the rubber. It is that the line stops. Unplanned downtime on a
main ore conveyor is measured in lakhs per hour, and a belt that parts at speed
can spill loaded material across machinery and people. The problem is not that
these failures are undetectable; it is that nobody is watching a belt at 3 a.m.

**C.A.R.R.Y. watches it.** A camera looks at the moving belt, a detection model
finds damage in each frame, a rules engine decides which detections are worth
recording, and a control-room dashboard shows the operator what is happening
and how the belt's condition is trending.

### 2. What the system does, end to end

A frame arrives — from a file, a USB camera, an RTSP camera or an MJPEG stream;
the pipeline does not care which. A **YOLO11** model returns boxes, each with a
class (`tear`, `hole`, `joint_damage`) and a confidence. **ByteTrack** links
those boxes across frames so one tear is one thing rather than thirty unrelated
detections. A track seen in five consecutive frames, above the recording
threshold, is **confirmed** into an **incident** — given a severity from its
geometry, photographed, and written to a Postgres database on Supabase. A React
dashboard then shows the annotated feed, a rail of open incidents, the
searchable history, and an analytics page reporting one condition figure called
**Reliability Yield**.

Alongside the camera there is a second, independent channel: an **ESP32** node
bolted to the same physical rig, reporting vibration (ADXL345 accelerometer) and
a light-gate reading (LDR) into its own Supabase project. Because both channels
watch the same one belt, a camera detection that coincides with a vibration
spike is **corroborated** — two different physics agreeing.

### 3. The words this project uses

The project is strict about vocabulary, because most of its bugs have been
category errors. Learn these five distinctions and most of the design explains
itself.

| Term | Means |
| --- | --- |
| **Detection** | One box in one frame. Cheap, noisy, disposable. |
| **Track** | The same defect followed across consecutive frames. Has an id and a hit count. |
| **Incident** | A track that survived confirmation. A record with a start, an end, a severity and a snapshot. This is the artefact a maintenance team reads. |
| **Sighting** | One incident row. A belt is a loop, so one defect produces a new sighting every revolution. |
| **Distinct defect** | The physical thing. Several sightings collapse into one distinct defect. |

A note on naming, because the project is pedantic about it and an examiner may
be too. The splice where the belt's two ends are bonded is a **belt joint** — a
normal structural feature, never an event. A belt joint that has begun to come
apart is a **joint rupture**, and that is the failure the problem statement is
about. In code the class identifier is `joint_damage` (for schema
compatibility) while the operator-facing label is "Belt Joint Rupture".
`CONTEXT.md` is the authority on this vocabulary and lists, for each term, the
words deliberately *not* used.

And three more that appear on the analytics page:

- **Coverage** — the fraction of frames read that the detector actually
  processed. Not a quality score; a statement about how much we looked at.
- **Corroboration** — a camera detection matched in time with an ESP32 event.
- **Reliability Yield** — the single 0–100 condition figure, defined in §27.

> **Why it matters.** The single most costly bug in this project's history was
> treating *sightings* as *distinct defects*. One tear, seen 52 times as the
> belt went round, scored as 52 tears and drove the health figure to zero. The
> vocabulary above is the fix, written down.

---

## Part II — Machine learning, from nothing

This part assumes you can program and assumes nothing else. Every term is
defined where it first appears, and every one is used again in Part III against
this project's real numbers.

### 4. What a model is

> **Definition — model.** A function with adjustable numbers in it. You choose
> the shape of the function; the training process chooses the numbers.

Ordinary programming: you write the rules, the computer applies them. **Machine
learning**: you supply examples of input and correct output, and the computer
searches for rules that reproduce them.

The adjustable numbers are called **parameters** or **weights**. A YOLO11-small
model has roughly nine million of them. Nobody sets them by hand; the training
process does, by repeatedly measuring how wrong the model is and nudging every
weight in the direction that makes it less wrong.

Two phases, and the whole subject splits along this line:

- **Training** — slow, done once, needs labelled examples and a GPU. Produces a
  file of weights (here, `backend/models/belt_v2.pt`, 18.3 MB).
- **Inference** — fast, done millions of times, needs only the weights. This is
  what runs when the camera is pointed at the belt.

This project is **supervised** learning: every training image came with
human-drawn boxes saying what was in it and where. The alternative,
unsupervised learning, has no labels and cannot tell you *what* it found — which
is useless when the answer must be "a tear, here, and it is severe".

### 5. Images, convolution, and what a CNN is

An image is a grid of numbers. A 640×640 colour frame is 640 × 640 × 3 =
1,228,800 numbers between 0 and 255.

You cannot connect a million inputs to a million neurons — the parameter count
explodes, and more importantly it is the wrong shape for the problem. A tear is
a tear whether it appears top-left or bottom-right. The thing that recognises
it should be the same thing everywhere in the image.

> **Definition — convolution.** Slide a small window (a **kernel**, typically
> 3×3) across the image. At each position, multiply the pixels under it by the
> kernel's weights and sum. The output is a new grid called a **feature map**.

The kernel's weights are learned, not designed. Early layers converge on
edge-and-gradient detectors; middle layers respond to texture and corners; deep
layers respond to whole object parts. Two properties make this work: the same
kernel is reused at every position (**weight sharing**, so far fewer
parameters), and it only ever looks at neighbours (**locality**, which is true
of images and not of, say, spreadsheets).

**Pooling** — or, in modern networks, a convolution with a stride of 2 — halves
the grid's width and height. Do it repeatedly and each later neuron "sees" a
larger region of the original image. That growing view is called the
**receptive field**, and it is why deep layers can respond to a whole tear
while shallow layers respond only to its edge.

> **Definition — CNN / backbone.** A stack of convolution and downsampling
> layers that turns an image into a small stack of information-dense feature
> maps. In a detector this stack is called the **backbone**; the layers that
> turn features into predictions are the **head**.

### 6. How training actually works

Six terms, in the order they occur in one training step.

> **Definition — loss.** A single number measuring how wrong the model's
> prediction is on a batch of examples. Lower is better. A detector's loss is a
> weighted sum of three parts: box loss (are the coordinates right), class loss
> (is it the right kind of defect), and an objectness/distribution term (is
> there anything here at all).

> **Definition — gradient descent.** For each weight, compute which direction
> would reduce the loss, and take a small step that way. Repeat.

> **Definition — backpropagation.** The chain rule applied backwards through
> the network, which is how the gradient for every one of the nine million
> weights is computed in a single pass rather than nine million passes. It is
> the algorithm that makes gradient descent affordable, not a separate idea.

> **Definition — learning rate.** The size of that step. Too large and the loss
> oscillates or diverges; too small and training never finishes. It is normally
> decayed over the run — large steps early, fine steps late.

> **Definition — batch.** The number of images processed before the weights are
> updated once. Bigger batches give a less noisy estimate of the gradient and
> need more GPU memory. **Epoch** = one complete pass over the training set.
> This project ran **120 epochs**.

The data is split before any of this happens:

- **Training set** — the model sees these and learns from them.
- **Validation set** — the model is scored on these but never learns from them.
  This is the honest estimate of performance.
- **Test set / field test** — held back entirely, touched once at the end.

> **Definition — overfitting.** The model memorises the training set instead of
> learning the general pattern. Symptom: training loss keeps falling while
> validation score stops improving or gets worse. **Underfitting** is the
> opposite — it has not learned even the training set, usually because it is too
> small, trained too briefly, or the learning rate is wrong.

**Early stopping** is the defence. Training watches the validation score and
stops if it has not improved for `patience` epochs — here **patience = 30** —
and keeps the best weights seen, not the last. The file that gets shipped is
therefore `best.pt`, not `last.pt`.

### 7. From "what" to "what and where"

**Classification** answers *what is in this image*. **Detection** answers *what
is in this image, and where, and how many*. Belt monitoring needs detection: an
operator has to be told which part of the belt to look at, and severity here is
computed from the size and position of the box.

> **Definition — bounding box.** Four numbers locating a rectangle. This project
> stores them **normalised** to 0–1, so they survive any change of resolution.

> **Definition — IoU (Intersection over Union).** Area of overlap divided by
> area of union, for two boxes. 1.0 is a perfect match, 0.0 is no overlap. IoU
> is the yardstick for "is this prediction the same object as that label", and
> the conventional pass mark is 0.5.

> **Definition — NMS (non-maximum suppression).** A detector proposes many
> overlapping boxes for one object. NMS keeps the highest-confidence box and
> deletes every other box overlapping it by more than an IoU threshold. Without
> it, one tear returns forty boxes.

> **Definition — confidence.** The model's own 0–1 estimate that a box contains
> what it says it contains. It is *not* a probability in any calibrated sense —
> it is a score you threshold. This project thresholds it twice; see §23.

**Two-stage** detectors (R-CNN family) first propose regions, then classify
each. Accurate, slow. **One-stage** detectors (YOLO, SSD) predict boxes and
classes in one pass over the image. Slightly less accurate historically, several
times faster. A conveyor belt must be watched in real time on modest hardware,
so this project is one-stage, and that is the entire justification.

### 8. YOLO, and why YOLO11s at 640 px

**YOLO** — "You Only Look Once" — divides the image into a grid and has every
cell predict boxes directly. One forward pass, one set of predictions. Modern
versions (v8 onward) are **anchor-free**: instead of matching predictions to
pre-defined box shapes, each cell regresses the distances to the object's four
edges. Fewer hyper-parameters to guess wrong.

**YOLO11**, from Ultralytics, ships in a size ladder — n(ano), s(mall),
m(edium), l(arge), x — which trade accuracy against speed and memory. The
choice made here:

| Choice | Value | Reason |
| --- | --- | --- |
| Family | YOLO11 | One-stage, real-time, excellent tooling, tracking built in |
| Size | **s** | `n` under-fits fine cracks; `m` and above cannot hold real-time on a laptop CPU or a modest GPU |
| Input | **640 px** | The Ultralytics default the pre-trained weights were built at; larger inputs were tested and did not help (§15) |
| Tracker | **ByteTrack** | Included with Ultralytics; notably keeps low-confidence detections as track candidates instead of discarding them, which suits faint early-stage wear |

### 9. Reading the metrics honestly

Four numbers, in dependency order.

> **Definition — precision.** Of the things the model flagged, what fraction
> were real? Low precision = false alarms.

> **Definition — recall.** Of the real things present, what fraction did the
> model find? Low recall = missed defects.

They trade off, and the confidence threshold is the dial between them. Lower it
and recall rises while precision falls.

> **Definition — PR curve and AP.** Sweep the confidence threshold from 1 to 0,
> plot precision against recall at every point. **Average Precision** is the
> area under that curve — one number summarising the whole trade-off, for one
> class. **mAP** is the mean of AP over all classes.

> **Definition — mAP@.5 vs mAP@.5:.95.** `mAP@.5` counts a prediction correct if
> it overlaps the label by IoU ≥ 0.5 — a lenient bar that asks "did you find it".
> `mAP@.5:.95` averages mAP over IoU thresholds 0.5, 0.55, … 0.95 — a strict bar
> that also asks "are your coordinates tight". The second is always much lower.
> Quoting only `mAP@.5` and calling it accuracy is the most common way to
> oversell a detector.

> **Definition — confusion matrix.** A grid of true class against predicted
> class. The diagonal is correct; everything off it tells you *which* mistake is
> being made. This project's are in `docs/model/` —
> `confusion_matrix_normalized.png` for `belt_v1` and
> `belt_v2_confusion_matrix_normalized.png` for `belt_v2`, alongside the
> per-epoch training curves in `results.png` and `belt_v2_results.png`.

Applied to this project's two models:

| Model | mAP@.5 | mAP@.5:.95 | Precision | Recall |
| --- | --- | --- | --- | --- |
| `belt_v1` (public data) | **95.1%** | 66.1% | 95.1% | 91.8% |
| `belt_v2` (own rig) | **85.6%** | 49.1% | 85.7% | 76.5% |

> **Honest caveat.** The lower model is the better one. §16 explains why, and it
> is the most important page in this book.

### 10. Transfer learning and warm starting

Training a detector from random weights needs hundreds of thousands of images.
Nobody has that for conveyor belts.

> **Definition — transfer learning.** Start from weights already trained on a
> large general dataset (here **COCO**: 80 everyday classes, ~118,000 images).
> The backbone has already learned edges, texture and shape from that data, and
> those features are not specific to cats and cars. Only the head has to learn
> what a tear looks like.

> **Definition — fine-tuning / warm starting.** Continuing training from an
> existing checkpoint rather than from scratch. The distinction from transfer
> learning is only about where the checkpoint came from.

This project warm-starts twice, and the chain is worth stating precisely:

**COCO** → `belt_v1` (public belt-damage datasets) → `belt_v2` (this rig's own
footage). Each step narrows the domain and keeps what the previous step learned
about edges and texture.

### 11. Data augmentation, knob by knob

> **Definition — augmentation.** Randomly transforming each training image
> every epoch — shifting, scaling, recolouring — so the model sees variations it
> would otherwise need more data to encounter. It combats overfitting and is
> free.

The defaults are wrong for a conveyor belt, and the settings in
`training/train.py` were chosen deliberately:

| Setting | Value | Reason |
| --- | --- | --- |
| `hsv_h` | 0.010 | Almost no hue jitter. Belt rubber is essentially hueless; shifting hue invents colours that never occur. |
| `hsv_s` | 0.40 | Moderate saturation jitter — dust changes it. |
| `hsv_v` | **0.60** | Aggressive brightness jitter. Lighting is *the* variable underground, and this is the augmentation that matters most here. |
| `degrees` | 3.0 | Barely any rotation. A belt is axis-aligned in a fixed camera; teaching 30° tilt teaches a lie. |
| `fliplr` | 0.5 | Left-right flip is safe — a tear has no handedness. |
| `flipud` | **0.0** | No vertical flip. Belts run one way and the camera is above; an upside-down belt is not a case that exists. |
| `erasing` | 0.25 | Randomly blank a patch, simulating a defect partly buried under ore. |
| `mosaic` | 1.0 | Stitch four training images into one, so the model sees many scales and contexts per step. |
| `close_mosaic` | 15 | Turn mosaic **off** for the last 15 epochs, so the model finishes on images that look like real frames rather than collages. |

> **Likely question — "why did you disable vertical flip?"** Because
> augmentation should expand the range of *plausible* inputs, not invent
> impossible ones. Every impossible image spends capacity the model could have
> spent on real variation.

---
## Part III — How this model was actually built

Eight stages, in order, with the scripts that ran each one. Everything in
`training/`.

### 12. Stage 1 — public data

Two openly licensed Roboflow datasets of conveyor-belt damage, **922** and
**651** images, both **CC BY 4.0** and attributed in `docs/DATASETS.md`.
Downloaded by `training/download_dataset.py`, imported by
`training/import_dataset.py`.

Starting with public data was not a shortcut. It bought a working detector
before the physical rig existed, and — as it turned out — it produced the
failure that taught the project the most.

### 13. Stage 2 — one vocabulary

Two datasets from two annotators name the same thing differently: `Tear`,
`tear`, `longitudinal-tear`, `rip`. `training/classes.py` holds an **alias
table** mapping every observed label onto the project's three canonical classes.

The important design decision: a label that matches no alias is **reported, not
silently dropped**. A silent drop deletes training signal and nobody notices
until the model mysteriously ignores a defect type.

Two classes present in the public data — `scratch` and `crack` — were
**excluded**, not merged. There were too few instances to learn from, and a
model must not advertise a class it has effectively never seen; an operator
reading "crack" from a class trained on eleven examples is being misled.

### 14. Stage 3 — merging

`training/merge_datasets.py` produces the unified set:

| | Count |
| --- | --- |
| Images | **1,573** |
| Annotations | **2,844** |
| `tear` | 1,455 |
| `hole` | 1,308 |
| `belt_joint` | **81** |

> **Honest caveat — class imbalance.** 1,455 tears against 81 joints is roughly
> **18:1**. A model sees the rare class rarely, gets little gradient signal from
> it, and can score well overall while being weak on it. This is a known
> limitation of `belt_v1` and is stated in the viva chapter rather than hidden.

### 15. Stage 4 — training `belt_v1`

| | |
| --- | --- |
| Host | Kaggle, 2 × NVIDIA T4 |
| Architecture | `yolo11s`, warm-started from COCO weights |
| Epochs | 120 at 640 px |
| Split | 1,134 train / 439 validation |
| Result | **mAP@.5 95.1%**, mAP@.5:.95 66.1%, P 95.1%, R 91.8% |
| Date | 2026-08-30 |

Ninety-five percent. On paper, finished.

### 16. Stage 5 — the failure that shaped the project

The model was pointed at 29 photographs of the actual prototype rig.

**It found damage in 7 of them.**

This is the single most instructive event in the project, and it is worth being
precise about what was ruled out before the conclusion was accepted:

| Attempted fix | Result |
| --- | --- |
| Drop confidence threshold to 0.05 | 12 / 29 |
| Run inference at 4× resolution | ~the same |

Neither is a tuning problem's signature. Tuning moves a model that is nearly
right; nothing moved.

> **Definition — domain shift.** The training data and the deployment data come
> from different distributions, so a model that has genuinely learned the
> training domain still fails. It is not overfitting — validation performance was
> honest — it is that validation and reality were different problems.

The specific shift here is close to an inversion:

| | Public datasets | The prototype rig |
| --- | --- | --- |
| Belt surface | Dusty mid-grey, industrial scale | Black rubber, small scale |
| How damage reads | *Darker* than the belt — shadow in a groove | *Brighter* than the belt — the light background shows through |
| Lighting | Underground, uneven, dim | Bench lighting, even |
| Camera | Fixed industrial, wide | Phone / webcam, close |

A model that learned "damage is the dark thing on the grey thing" is being shown
"damage is the bright thing on the black thing". Ninety-five percent was a true
number about the wrong question.

> **Why it matters.** The reflex response to 7/29 is to retrain longer or go up a
> model size. Both would have wasted days. The correct response was to change the
> data, and recognising that is the difference between doing ML and running ML
> scripts.

### 17. Stage 6 — building a dataset of the real rig

Five scripts, each solving one problem that would otherwise have been hours of
manual work.

**`extract_frames.py` — turn video into candidate images.**
Samples sparsely rather than taking every frame (consecutive frames are the same
picture). Rejects blurred frames by **Laplacian variance** — a measure of edge
energy, where a motion-blurred frame scored ~3.5 against ~68 for a sharp one.
Detects near-duplicate clips at **>0.99 cosine similarity** so the same footage
imported twice does not inflate the dataset. One video was **held out entirely**
as a field test and never entered training.

**`pick_seed.py` — choose the first images to label by hand.**
Uses **farthest-point sampling**: repeatedly pick the candidate least similar to
everything already chosen, so a small seed set spans the variety of the footage
instead of clustering on one moment. Frames containing the joint rupture are
force-included, because the rarest class cannot be left to chance.

**`label_tool.py` — draw the boxes.**
A local tool, not a cloud service (ADR 0005). Three states per image —
unlabelled, labelled, explicitly *negative*. **54 of the 158 images are
negatives — 34%** — and that is deliberate: a detector trained only on damage learns that
every image contains damage. Clean belt is a class of evidence, even though it
has no boxes.

**`propagate_labels.py` — stop drawing, start correcting.**
A model trained on the seed set pre-labels the remaining frames; the human then
*corrects* boxes rather than drawing them. Its confidence threshold is set
**low on purpose**: a spurious box is deleted with one click, a missing box has
to be drawn from scratch, so recall is worth more than precision here.

**`split_dataset.py` — split by time, never at random.**
Frames 425 and 430 of the same video are the same picture. Split them randomly
and one lands in training and one in validation, so the model is validated on
data it has memorised and the score is meaningless. The split is therefore
**chronological**: whole segments go to one side or the other (ADR 0004).

> **Likely question — "why not just use a random split?"** Because with video
> the samples are not independent. A random split leaks the validation set into
> training and produces a number that flatters the model and predicts nothing.

### 18. Stage 7 — training `belt_v2`

| | |
| --- | --- |
| Host | Kaggle, 2 × T4 |
| Architecture | `yolo11s`, **warm-started from `belt_v1.pt`** |
| Data | `training/data/rig_dataset` — own footage |
| Epochs | 120 at 640 px |
| Split | **130 train / 28 validation** |
| Classes | `tear`, `hole`, **`joint_damage`** |
| Result | **mAP@.5 85.6%**, mAP@.5:.95 49.1%, P 85.7%, R 76.5% |
| Date | 2026-09-01 |

Note the third class changed. `belt_v1` detected `belt_joint` — the presence of
a splice. `belt_v2` detects `joint_damage` — a splice that is *coming apart*.
The first is a normal structural feature that passes the camera every
revolution; the second is an emergency. An earlier version tried to derive
rupture geometrically (does a tear overlap a joint band?) through three
formulations — IoU, containment, edge contact — before that heuristic was
deleted and replaced by a directly trained class (ADR 0003).

> **Why it matters — 85.6% is better than 95.1%.** The two numbers are not
> comparable, because they are measured on different data. `belt_v1`'s 95.1%
> was measured on public images and did not predict its behaviour on the rig.
> `belt_v2`'s 85.6% is measured on held-out footage of the belt it will actually
> watch. A lower number on the right question beats a higher number on the wrong
> one, and being able to say that sentence is the point of §9.

### 19. Stage 8 — evaluating on reality

`training/evaluate.py`, on data the model never trained on:

| Check | `belt_v1` | `belt_v2` |
| --- | --- | --- |
| Long tear (6 stills) | 0 / 6 | **6 / 6** |
| Large hole (4 stills) | 0 / 4 | **4 / 4** |
| Small tear (8 stills) | 1 / 8 | **8 / 8** |
| Hole (7 stills) | 4 / 7 | **6 / 7** |
| Joint rupture (4 stills) | 2 / 4, *mislabelled `tear`* | **3 / 4, correct class** |
| **Total stills** | **7 / 29** | **27 / 29** |
| Held-out video, 281 frames | 33%, *every box mislabelled `hole`* | **52%**, classes distinguished |
| False rupture alarms over 614 frames of healthy belt | — | **0** |

The class column matters as much as the count. `belt_v1` did occasionally put a
box in the right place, then call it the wrong thing — a `tear` where the joint
was rupturing. A detector that finds damage but cannot name it cannot drive a
severity, and severity is what decides whether anyone is woken up.

The last row is the one to lead with in a viva. Over 614 frames, the healthy
splice passed the camera repeatedly and was **never once** reported as a
rupture. Precision on the emergency class is what makes an alarm worth
listening to; a system that cries wolf every revolution gets muted in a week.

> **Honest caveat.** "52% of frames contain a detection" is *not* accuracy. The
> belt is a loop: a defect is only in view for part of each revolution, so the
> ceiling is well below 100% and the number is a coverage-of-frames figure, not
> a hit rate. Quote it with that sentence attached. See §31.

---
## Part IV — The software

Where every piece lives, and why it is built that way. Paths are relative to the
repository root.

### 20. The pipeline, and the real-time guarantee

```
FrameSource ──▶ LatestFrame (one slot) ──▶ YOLO + ByteTrack ──▶ IncidentEngine
                                                 │                    │
                                        annotated frame          open/update/close
                                                 ▼                    ▼
                                          MJPEG stream          EventBus ─▶ WebSocket ─▶ React
                                                                      │
                                                                      ▼
                                                        Supabase: rows + snapshot JPEGs
```

Capture runs on one thread, inference on another, and the handoff between them
is a **one-deep slot**, not a queue: a newer frame overwrites an unread one and
the frames in between are never seen (`backend/app/pipeline/capture.py`).

A queue is the obvious structure and was rejected deliberately. With a queue, a
detector slower than the camera never drops anything — it simply falls further
behind, and what looks like live monitoring is batch processing at a growing
delay. The point of the system is watching the belt **now**, so discarding stale
frames is correct behaviour.

> **Why it matters.** This is what makes a video file an honest stand-in for a
> camera. Uploading decodes nothing; playback tracks the wall clock, so a
> 60-second clip takes 60 seconds; and frames arriving while the model is busy
> are dropped. `frames_skipped` is therefore a **headline metric on the
> dashboard, not an error count** — a batch process would report zero forever, so
> a non-zero value is visible proof the guarantee holds. (ADR 0001.)

### 21. Frame sources

Everything that can supply frames satisfies one contract in
`backend/app/sources/base.py`, and `factory.py` picks the implementation from a
URI scheme:

| URI | Class | Paced by |
| --- | --- | --- |
| `file://…` | `FileSource` | the wall clock, at the file's own fps |
| `device://0` | `DeviceSource` | the camera driver |
| `rtsp://…` | `RtspSource` | the IP camera |
| `http://…mjpeg` | `HttpMjpegSource` | the network stream |

Swapping a test video for a real camera is one line in `backend/.env`
(`SOURCE_URI=device://0`), because nothing above the source layer knows which
one it has.

### 22. The detector

`backend/app/pipeline/detector.py` runs Ultralytics YOLO11 with ByteTrack
enabled, at `CONF_THRESHOLD` (0.35), `IOU_THRESHOLD` (0.45, for NMS) and
`IMG_SIZE` (640). `DEVICE=auto` picks CUDA, then Apple MPS, then CPU.

`DETECTOR=mock` exists so the pipeline was demonstrable before a model did. It
labels itself "SYNTHETIC, not a trained model" wherever it appears. It is
scaffolding, not a demo; `DETECTOR=yolo` removes it entirely.

**CLAHE is off, and the reason is a good viva answer.** CLAHE (Contrast
Limited Adaptive Histogram Equalisation, in `pipeline/preprocess.py`) boosts
local contrast, which Guo et al. identify as the fix for dust-obscured belt
imagery. Measured on this project's footage with `belt_v1`:

| | CLAHE off | CLAHE on |
| --- | --- | --- |
| Detections over 150 frames | **58** | 7 |
| Stills with any detection | **13 / 56** | 11 / 56 |
| Inference per frame @1080p | **95.6 ms** | 140.9 ms |

An 88% drop in detections and 48% slower. The cause is a **train/serve skew**:
nothing in `training/` applies CLAHE, so enabling it trains the model on raw
pixels and then serves it enhanced ones. The knob stays, because the reasoning
is sound and it becomes the right default the moment training applies the same
enhancement.

### 23. Detections into incidents

`backend/app/pipeline/events.py`. Four rules, in order.

**1. Landmarks are not events.** `belt_joint` is drawn and tracked but never
opens an incident (`NON_INCIDENT_CLASSES`). An earlier version raised one on
sight and recorded ~80 identical `Belt Joint / INFO` rows in a single session,
burying the tears an operator needed. `joint_damage` — the splice actually
coming apart — is a defect like any other and opens a CRITICAL incident.
(ADR 0002.)

**2. Severity comes from geometry, not just class.** `score_severity()` starts
from `BASE_SEVERITY` (`joint_damage` CRITICAL, `tear`/`hole` HIGH, `crack`
MEDIUM, `scratch` LOW) and escalates: a defect with aspect ratio ≥ 3.0 covering
≥ 45% of frame height is the running rip-through case and bumps **two** levels;
half that height bumps one; any defect over 4% of frame area bumps one. A belt
joint is exempt from all of it, because joints span the belt by design and a
geometry rule would fire on every healthy one.

**3. Temporal confirmation.** A track must be seen in `CONFIRM_FRAMES = 5`
consecutive frames before an incident opens, and is closed after
`MISS_TOLERANCE = 20` consecutive misses. This is the temporal answer to the
small-object false positives that Guo et al. flag as the standard failure mode
of one-stage detectors on this task.

**4. A separate bar for the log.** The detector reports at 0.35; promotion into
an incident requires `INCIDENT_CONFIDENCE_THRESHOLD = 0.50`, applied in
`IncidentEngine.observe`. Between the two sits a band where a box is drawn on
the live stream and sent to the browser but never advanced into a track — so it
cannot open an incident, write a snapshot or reach the alert rail however long
it persists.

> **Why it matters.** One threshold forces a choice between two things the
> operator wants at once. Set it high and marginal wear vanishes from the feed.
> Set it low and the incident history — the artefact that becomes a maintenance
> record — fills with things nobody would act on. Splitting them lets the feed
> stay permissive and the log stay strict. Both are tunable live from the
> Settings page. (ADR 0008.)

### 24. Where the data lives — two Supabase projects

This is the question examiners ask when they see two sets of credentials, so it
is worth being exact. **There are two entirely separate Supabase projects, and
they are not the same database.**

**Project 1 — the incident history.** Owned by the backend, reached over direct
Postgres (`psycopg`, transaction pooler, port 6543) from
`backend/app/store/db.py`. Two tables:

| Table | Columns |
| --- | --- |
| `sessions` | `id`, `source_uri`, `source_kind`, `label`, `detector`, `started_at`, `ended_at`, `frames_read`, `frames_processed`, `frames_skipped` |
| `incidents` | `id`, `session_id`, `track_id`, `cls`, `label`, `severity`, `confidence`, `opened_at`, `closed_at`, `duration`, `first_frame`, `last_frame`, `snapshot`, `box` |

Snapshot JPEGs go to a **private Supabase Storage bucket**
(`backend/app/store/storage.py`); the row holds only the object key, and
`GET /api/incidents/{id}/snapshot` answers with a 302 to a short-lived signed
URL so the bytes never travel through the API box. Uploads are asynchronous on
one background worker — a failed upload is logged and dropped, because losing
evidence is better than stalling the stream.

This all used to be SQLite on local disk. It moved because the free hosting
tier has no persistent disk: every redeploy and every spin-down after fifteen
idle minutes erased the history and broke every thumbnail (ADR 0006).

**Project 2 — the rig telemetry.** Owned by the **ESP32 node**, and read
**directly by the browser** with the anon key from `frontend/.env`. One table,
`readings`: `device`, `vibration`, `ldr`, `light_percent`, `status`
(`NORMAL` / `WARNING`), written roughly once a second by the firmware in
`belt-llive-code/firmware/belt-monitor/belt-monitor.ino`. The frontend
subscribes over Supabase Realtime (`frontend/src/lib/rig/useLiveBeltFeed.ts`).

> **Honest caveat.** The backend holds no credentials for project 2, which is
> why `/api/analytics/reliability` returns `corroboration: null` and the join is
> performed in the browser. The two projects also run on **different clocks**, so
> cross-channel matching is accurate to about **±5 seconds**, and the UI says so.

### 25. The API surface

FastAPI, mounted in `backend/app/main.py`, six routers under `backend/app/api/`:

| Router | Prefix | Notable endpoints |
| --- | --- | --- |
| `sources.py` | `/api/sources` | `/videos`, `POST /upload`, `/devices`, `/thumbnail/{name}` |
| `stream.py` | `/api/stream` | `POST /start`, `POST /stop`, `/status`, `/mjpeg`, `/snapshot` |
| `incidents.py` | `/api/incidents` | list, `/summary`, `/{id}/snapshot`, `/export.csv` |
| `analytics.py` | `/api/analytics` | `/sessions`, `/reliability`, `/timeseries`, `/geometry` |
| `settings_api.py` | `/api/settings` | `GET`, `PATCH` — live knobs, no restart |
| `ws.py` | — | `WS /ws/events` |

Everything that must reach the browser *as it happens* goes over the WebSocket;
everything historical is REST. `backend/app/bus.py` is a topic-based
publish/subscribe bus sitting between them, so the vision pipeline is merely its
first publisher and a future SCADA bridge attaches without touching anything
above it.

### 26. The dashboard

React 19 + Vite + Tailwind v4, in `frontend/src/`. A hash router
(`components/Router.tsx`) over six pages in `pages/`:

| Page | File | Shows |
| --- | --- | --- |
| Live monitor | `pages/LiveMonitor.tsx` | Annotated MJPEG feed, alert rail, stats bar, Reliability Yield |
| Sources | `pages/Sources.tsx` | Pick or upload a source, start and stop the stream |
| Incidents | `pages/Incidents.tsx` | Searchable history with snapshot evidence and CSV export |
| Analytics | `pages/Analytics.tsx` | The diagnostics surface — §27 |
| 3D Model | `pages/Rig.tsx` | three.js model of the rig, driven by live ESP32 telemetry |
| Settings | `pages/Settings.tsx` | The runtime knobs |

The visual system is documented in `DESIGN.md` and defined once as CSS custom
properties in `frontend/src/index.css`; components never use raw Tailwind
colours. Severity owns red/orange/amber/blue, so the shell's own accent is acid
lime — chrome may never borrow a severity hue, because a colour an operator
reads as a belt condition must only ever mean that.

### 27. Reliability Yield

`backend/app/analytics/reliability.py`, surfaced on `pages/Analytics.tsx`. It is
**four published figures, not one opaque number**:

| Figure | Is |
| --- | --- |
| **Condition** | 0–100 over *distinct physical defects*, weighted by severity, confidence, size and persistence |
| **Coverage** | `frames_processed / frames_read` — how much of the belt was actually inspected |
| **Corroboration** | Share of rupture-class defects the ESP32's optical sensor independently flagged |
| **Trend** | Change in condition across the window |

**The bug it exists to fix.** The old `beltHealth()` was
`100 · exp(−Σ weight[severity] × count / 120)` over raw incident rows. A belt is
a loop, so one tear leaves the frame, comes round again, gets a new track id and
opens a **new incident row every revolution**. On one real run, **52 incident
rows described 7 distinct defects**; the old score read **0**, the new one **40**.
A belt turning every 40 seconds was penalised eight times as hard as an
identical belt turning every five minutes, and a stationary belt with a hole in
it scored perfectly. The score was measuring belt speed. (ADR 0009.)

**How deduplication works.** Two sightings merge when they share a class, sit
within **8% of belt width** of each other, are within **2.5×** each other's
area, **and do not overlap in time**. That last condition is what keeps it
honest: a defect cannot be in two places at once, so two sightings that coexist
are necessarily two defects however alike their geometry.

Four design decisions worth being able to defend:

- **Both counts always travel together.** Raw rows beside distinct defects. The
  gap between them *is* the correction; hiding it would make the score
  unauditable.
- **Condition is not a rate.** An earlier version divided the penalty by hours
  observed. A tear does not heal because the window got longer, so that let real
  damage fade out of the score by waiting. Discovery rate is reported separately
  as `defects_per_hour`, and a test pins the property.
- **Coverage is published beside condition, never folded in.** A clean belt and
  a belt nobody looked at both produce zero incidents; only coverage tells them
  apart.
- **Absence renders differently from disagreement.** With the node unplugged,
  corroboration reads "No data", not 0% — the second would tell an engineer the
  hardware disagrees when in fact it was absent. Trend likewise returns *null*
  rather than a number when a half of the window is empty or the window is
  shorter than ten minutes; on a 34-second clip the naive version cheerfully
  reported "improved by 60 points".

Two smaller honesties on the same page: a panel drawing a distribution declares
a minimum sample size and lists the raw values with `n =` below it, because a
twenty-bin histogram holding three bars shows the sample rather than the
distribution; and the detector's 0.35 threshold is deliberately **not** drawn on
the confidence chart, because nothing is ever recorded below the incident bar
and a line down there would imply the detector found nothing rather than that
the pipeline declined to write it down.

### 28. The second channel — the ESP32 node

A physical ESP32 on the rig carries an **ADXL345 accelerometer** and an **LDR
array** sitting between the belt runs under a laser gantry. It posts a reading
about once a second and takes no commands back — the dashboard can watch it,
never drive it.

The **3D Model** tab (`pages/Rig.tsx`, geometry in `lib/rig/conveyor-model.ts`)
renders the rig at real-world scale in three.js and binds it to that feed:

| On screen | Driven by |
| --- | --- |
| Belt runs or sits still | Smoothed \|vibration\| crossing `MOTION_THRESHOLD` |
| Frame jitter | The same vibration reading, scaled and capped |
| A rupture opening in the belt | Edge-triggered on a live `NORMAL → WARNING` transition |
| Beacon, interlock banner | An active `WARNING`, or the node going silent |

With the node unplugged the panel reads `OFFLINE` and the belt stops, rather
than animating on regardless.

**Fusion.** `frontend/src/lib/analytics.ts` joins the two channels on one time
axis. This is legitimate for one specific reason: **both instruments watch the
same single physical belt.** A camera detection that coincides with a vibration
spike within ±5 s is *corroborated* — two different physics agreeing — which is
a far stronger claim than either channel alone.

> **Honest caveat.** A rupture shown on the 3D Model reflects the node's own
> onboard threshold logic, not a confirmed camera-detected incident. The two are
> not interchangeable, and the page says so.

### 29. Code map — where to look when asked

| If asked about… | Open |
| --- | --- |
| The real-time guarantee, frame slot | `backend/app/pipeline/capture.py`, `docs/adr/0001` |
| Cameras, files, RTSP | `backend/app/sources/` (`base` `file` `device` `network` `factory`) |
| The model, tracking, thresholds | `backend/app/pipeline/detector.py` |
| CLAHE | `backend/app/pipeline/preprocess.py` |
| Severity, confirmation, incidents | `backend/app/pipeline/events.py`, `docs/adr/0002`, `0008` |
| Drawing boxes on the frame | `backend/app/pipeline/annotate.py` |
| The inference loop, session bookkeeping | `backend/app/pipeline/worker.py`, `session.py` |
| Database schema and queries | `backend/app/store/db.py`, `docs/adr/0006` |
| Snapshot upload / signed URLs | `backend/app/store/storage.py` |
| Reliability Yield maths | `backend/app/analytics/reliability.py`, `docs/adr/0009` |
| Its tests | `backend/tests/test_reliability.py` (19 tests) |
| REST + WebSocket | `backend/app/api/`, `backend/app/main.py`, `backend/app/bus.py` |
| Runtime configuration | `backend/app/config.py`, `backend/.env` |
| Dashboard routing and shell | `frontend/src/App.tsx`, `components/Router.tsx` |
| Analytics panels | `frontend/src/components/analytics/` (7 components) |
| Two-channel fusion | `frontend/src/lib/analytics.ts` |
| The 3D rig | `frontend/src/pages/Rig.tsx`, `lib/rig/conveyor-model.ts` |
| Live telemetry subscription | `frontend/src/lib/rig/useLiveBeltFeed.ts` |
| Colour and type tokens | `frontend/src/index.css`, `DESIGN.md` |
| Frame extraction, labelling, splitting | `training/extract_frames.py`, `label_tool.py`, `split_dataset.py` |
| Class vocabulary and aliases | `training/classes.py`, `docs/DATASETS.md` |
| Training and evaluation | `training/train.py`, `training/evaluate.py`, `kaggle_rig.ipynb` |
| Shipped model metrics, curves, confusion matrices | `backend/models/*.metrics.txt`, `docs/model/` |
| Every load-bearing decision | `docs/adr/0001`–`0009` |
| The project's vocabulary | `CONTEXT.md` |

---

## Part V — Being questioned

### 30. Questions you should expect

**"What is an epoch?"** One complete pass of the training set through the model.
This project ran 120. Not to be confused with a batch, which is how many images
are processed between weight updates — 8 here, because at 16 the run needed
4.3 GB, started paging, and took 18 minutes an epoch instead of 4.

**"What does mAP@.5 mean, and why not just accuracy?"** Accuracy is undefined
for detection: there is no fixed number of predictions to be right about. mAP
is the mean over classes of the area under the precision-recall curve, at an IoU
match threshold of 0.5. `mAP@.5:.95` averages that over stricter thresholds and
is the honest number to quote.

**"Why YOLO and not Faster R-CNN?"** Real-time. Guo et al.'s own benchmark on a
1,092-image belt dataset measured YOLOv5m at 82.5% mAP@.5 and **128 FPS**
against Faster R-CNN's 86.4% at **7.4 FPS**. Four points of mAP for a 17× speed
penalty is the wrong trade for a belt that must be watched continuously.

**"Why is your second model worse?"** It is not; it is measured on a different
and harder question. See §18 — this is the answer to rehearse most.

**"How much data did you have?"** 1,573 public images / 2,844 annotations for
`belt_v1`; 158 images of our own rig (130 train / 28 validation) for `belt_v2`,
of which 54 are deliberate negatives.

**"How do you avoid false alarms?"** Four independent mechanisms: five-frame
temporal confirmation; a separate, higher confidence bar for the log than for
the display; landmark classes excluded from incidents entirely; and negatives at
34% of the training set so the model has seen a great deal of clean belt.

**"What happens if the model misses something?"** Coverage is published, so the
operator sees how much was inspected; the second sensor channel is independent
of the camera; and a belt is a loop, so a missed defect comes round again.

**"Can it run on a real plant camera?"** The source layer already speaks RTSP.
The model would need retraining on that plant's footage — which is exactly what
`training/` is for, and exactly the lesson of §16.

### 31. The hard questions, answered honestly

These are the ones that decide whether a panel believes you. Answer them before
they are asked.

> **`joint_damage` is trained on six instances of one physical rupture.** It
> reliably detects *that* rupture on *that* belt under *that* lighting, which is
> what a demonstration needs. It is not general joint-rupture detection and must
> not be described as such.

> **`belt_v2` is deliberately narrow.** It is specialised to the prototype rig
> and is expected to do badly on industrial belt imagery. `belt_v1` stays in the
> repository for that case. Both remain because a model trained on one belt does
> not transfer to another — in either direction.

> **"52% detection" is not accuracy.** It is the share of frames of a held-out
> clip containing any box. Defects rotate in and out of view, so the ceiling is
> well below 100%. Read it as "far more of the belt is now seen correctly".

> **The validation set is 28 images.** Any single-image change moves mAP by
> about 3.5 percentage points, so 85.6% should be read as a band, not a
> measurement. The field test on unseen footage is the number to trust.

> **`belt_joint` is 18:1 under-represented** in the public data — 81 instances
> against 1,455 tears — which is why `belt_v1` handles it worst. The fix is
> known and cheap (joints recur every revolution, so a few minutes of footage
> yields many instances); it has not been done yet.

> **CLAHE is disabled despite the literature supporting it**, because we apply
> it at inference and not in training. That is a train/serve skew, and the
> measurement in §22 is what caught it.

> **One documentation file is out of date, and we know which.**
> `docs/DATASETS.md` still says `joint_damage` is *derived at runtime* by
> promoting a `belt_joint` that overlaps a tear. That was true through three
> formulations — IoU, containment, edge contact — and was then replaced by a
> directly trained class, with the geometry deleted (ADR 0003). "We replaced a
> heuristic with a measured class" is a good answer, not an embarrassment.

### 32. Glossary

Set this as a two-column list, one term per line, at the smaller table size.

**AP / mAP** — area under the precision-recall curve, for one class / averaged
over classes. **Augmentation** — random transformation of training images to
expand effective data. **Backbone** — the convolutional stack turning an image
into features. **Backpropagation** — the chain rule run backwards to get every
weight's gradient in one pass. **Batch** — images processed between weight
updates. **Bounding box** — four numbers locating a rectangle; stored normalised
0–1. **ByteTrack** — the tracker; keeps low-confidence detections as track
candidates. **CLAHE** — contrast-limited adaptive histogram equalisation.
**COCO** — the 118k-image general dataset the pre-trained weights come from.
**Confidence** — the model's own 0–1 score for a box; a threshold input, not a
calibrated probability. **Confirmation** — the five-consecutive-frame rule
before an incident opens. **Corroboration** — agreement between the camera and
the ESP32 node. **Coverage** — frames processed over frames read. **Detection**
— one box in one frame. **Distinct defect** — one physical defect after merging
sightings. **Domain shift** — training and deployment data drawn from different
distributions. **Early stopping** — halt when validation stops improving.
**Epoch** — one pass over the training set. **Fine-tuning / warm starting** —
continuing training from existing weights. **Frame slot** — the one-deep
capture-to-inference handoff. **Incident** — a confirmed defect with a lifetime,
a severity and a snapshot. **Inference** — running a trained model. **IoU** —
intersection over union. **Learning rate** — gradient step size. **Loss** — how
wrong the model is, as one number. **Mosaic** — four training images stitched
into one. **Negative** — an image kept precisely because it contains no defect.
**NMS** — non-maximum suppression. **One-stage detector** — predicts boxes and
classes in a single pass. **Overfitting** — memorising the training set.
**Precision** — of what was flagged, how much was real. **Recall** — of what was
there, how much was found. **Reliability Yield** — the 0–100 condition index.
**Session** — one continuous run of the pipeline. **Severity** — INFO to
CRITICAL, from class and geometry. **Sighting** — one incident row as evidence
of a defect. **Track** — a defect followed across frames. **Transfer learning**
— starting from weights trained on other data.

---

*End of book.*
