# Labelling happens in a local tool, not a hosted service

Annotation is done by `training/label_tool.py`, a single-file local web page,
rather than in a hosted labelling platform. Datasets never leave the machine.

The hosted route was tried first. Its automatic labelling, prompted with
descriptions of the defects, found nothing for two of the three classes on this
imagery — belt defects on rubber are not a concept foundation models have seen
much of — and its manual editor was more tool than 150 images justified.

Writing the tool was cheaper than the alternative because the workflow needed
three states a generic annotator does not distinguish: an image with boxes, an
image deliberately kept as a negative, and an image excluded from the dataset
entirely. Collapsing the last two loses the negatives, which are 34% of this
dataset and the reason the detector stays quiet on undamaged belt.

## Consequences

There is no dataset versioning, no multi-user review, and no hosted backup. For
a dataset of this size, produced once, that is an acceptable trade; it would not
be for a dataset under continuous revision.

Training therefore reads the dataset committed in this repository rather than
fetching it, which is why `training/data/rig_dataset/` is a deliberate exception
in `.gitignore`.
