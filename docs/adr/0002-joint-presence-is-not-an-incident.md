# A belt joint's presence is not an incident; rupture is a trained class

Detecting a belt joint never opens an incident. Only a *joint rupture* does, and
rupture is detected directly by the model rather than inferred from geometry.

A belt is a loop, so its joint passes the camera every revolution. An earlier
version raised an informational incident each time, recording 80 near-identical
rows at roughly one a minute, interleaved with the tears and holes an operator
needs to see. A recurring structural feature is not an event.

An earlier version also derived rupture geometrically, by testing whether a tear
or hole overlapped a detected joint band. That rule went through three
formulations — IoU, containment, and edge contact — before being replaced by a
trained `joint_damage` class. The geometry and its tests were deleted.

## Consequences

The runtime guard suppressing incidents for `belt_joint` remains, because
`belt_v1` still emits that class and is still selectable via `MODEL_PATH`.
It exists to protect against older weights, not because the class is wanted.

The class identifier is `joint_damage` for schema compatibility, while the
operator-facing label is "Belt Joint Rupture". The glossary prefers the latter;
the former survives in code and datasets.
