# Capture hands off through a one-deep slot, not a queue

Capture and inference share a single frame slot: a newer frame overwrites an
unread one, and the frames in between are never seen. A queue is the obvious
structure here and was rejected deliberately — with a queue, a detector slower
than the source never drops anything, it simply falls further behind, and what
looks like live monitoring is really batch processing at a growing delay.

The point of the system is watching a belt *now*. Discarding stale frames is
correct behaviour, not a limitation, and it is what makes an uploaded video an
honest stand-in for a camera: both are paced by something outside the pipeline,
and both lose frames the detector cannot keep up with.

## Consequences

`frames_skipped` is a headline metric on the dashboard rather than an error
count. A batch process would report zero forever, so a non-zero value is the
visible proof the guarantee holds.

This is easy to undo by accident. Anyone replacing the slot with a queue to
"stop losing frames" removes the property the system is built on, which is why
it is pinned by tests.
