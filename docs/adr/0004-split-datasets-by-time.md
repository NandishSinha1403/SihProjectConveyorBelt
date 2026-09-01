# Datasets are split by time, never at random

Validation images are a contiguous tail of a clip plus a fixed sample of stills.
The standard random split is wrong for this data and is not used.

Training images come mostly from video. Frames 425 and 430 of the same clip are
the same picture, so a random split puts near-identical images on both sides and
validates the model on data it effectively trained on. The resulting metrics look
excellent and mean nothing.

## Consequences

Validation sets are small — 28 images against 130 for training — because a
contiguous block cannot be sized freely.

All six `joint_damage` instances are forced into training. With so few, a
validation subset could only score 0%, 50% or 100% while costing a third of the
signal for the class the project is judged on. That class is measured by field
test instead, which is the honest check regardless.

This decision is easy to reverse and easy to reverse *by accident*: any tooling
that reshuffles the dataset silently restores the flattering numbers.
