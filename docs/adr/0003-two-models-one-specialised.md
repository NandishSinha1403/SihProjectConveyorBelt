# Two models ship, and the demonstration one is deliberately narrow

`belt_v1` is trained on public industrial belt imagery; `belt_v2` is trained on
this project's own rig and is used for demonstrations. Both stay in the
repository, selected by `MODEL_PATH`.

`belt_v1` scores 95.1% mAP@.5 on its own validation split but detects damage in
only 7 of 29 photographs of the prototype rig. This is a domain shift rather
than a tuning problem: lowering confidence from 0.35 to 0.05 reached only 12/29,
and so did quadrupling the input resolution. The rig is black rubber where
defects read as bright background showing through, while the public data is
dusty grey belting where defects are dark-on-dark texture — close to inverted
problems.

Specialising was chosen over generalising because the demonstration runs on one
known belt, and a model that works there is worth more than one that works
moderately everywhere. Keeping both is the hedge: the question "does this work
on a real mine conveyor?" is answered by `belt_v1`, honestly labelled as a
different model.

## Consequences

`belt_v2` is expected to perform poorly on industrial imagery and must never be
presented as a general belt-damage detector. Its `joint_damage` class rests on
six labelled instances of a single physical rupture.
