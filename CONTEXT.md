# Belt Sentinel

Vision-based condition monitoring for a conveyor belt: a camera watches the
belt, a detector finds damage, and an operator sees events rather than raw
detections. This glossary fixes the vocabulary shared by the backend pipeline,
the dashboard, the training tools and the datasets.

## The belt and its damage

**Belt**:
The continuous rubber loop being monitored. Because it is a loop, every feature
on it returns past the camera once per revolution.
_Avoid_: conveyor (that is the whole machine), band

**Belt joint**:
The splice where the two ends of the belt are bonded into a loop. A normal
structural feature, not damage. Its presence is never an event.
_Avoid_: seam, weld, splice, join

**Joint rupture**:
A belt joint that has begun to come apart, visible as an opening at the belt
edge where the bonded ends have separated. The failure mode this project exists
to catch, and the only joint-related event.
_Avoid_: joint damage, joint failure, split joint

**Tear**:
An elongated cut through the belt surface.
_Avoid_: rip, slit, cut, laceration

**Hole**:
A compact opening through the belt surface, including a torn-out section.
_Avoid_: puncture, perforation, gouge

**Defect**:
Any of tear, hole or joint rupture. The collective noun for what the detector
looks for.
_Avoid_: damage, fault, anomaly, flaw

## Seeing

**Frame source**:
Anything that can supply frames one at a time — a video file, a USB camera, an
IP camera. All sources are interchangeable to the rest of the system.
_Avoid_: input, feed, stream source, capture device

**Live source**:
A frame source paced by hardware rather than by a clock the system controls. A
video file is deliberately *not* live, but is treated identically to one.
_Avoid_: real-time source, camera source

**Frame slot**:
The single-frame handoff between capture and inference. It holds exactly one
frame; a newer frame replaces an unread one.
_Avoid_: buffer, queue, frame buffer

**Skipped frame**:
A frame that arrived while inference was busy and was therefore never seen. An
expected, measured outcome — not an error.
_Avoid_: dropped frame, lost frame, missed frame

**Detection**:
One defect found in one frame, with a class, a confidence and a box. Ephemeral:
a single defect produces hundreds of detections as it crosses the view.
_Avoid_: prediction, box, hit, finding

**Track**:
A series of detections across consecutive frames judged to be the same physical
defect. Gives a defect an identity over time.
_Avoid_: trace, trajectory, object id

## Reporting

**Incident**:
A defect confirmed over enough consecutive frames to be believed, recorded with
photographic evidence and a lifetime. The unit an operator acts on, and the only
thing that reaches the alert feed.
_Avoid_: alert, event, alarm, detection

**Confirmation**:
The requirement that a track persist across several consecutive frames before it
becomes an incident. What separates a real defect from a one-frame artefact.
_Avoid_: debounce, validation, filtering

**Incident threshold**:
The confidence a detection must carry before it is eligible to become an
incident, set above the detector's own threshold. A detection below it is still
drawn and streamed — it is declined an incident, not hidden.
_Avoid_: confidence threshold (that is the detector's, and a different number)

**Severity**:
The urgency of an incident, from INFO through CRITICAL, derived from its class
and its geometry. A property of an incident, never a category of defect.
_Avoid_: priority, level, criticality

**Snapshot**:
The still image captured when an incident opens, kept as evidence for a
maintenance record.
_Avoid_: thumbnail, capture, screenshot, still

**Session**:
One continuous run of the pipeline over one source, from start to stop. Incident
numbering restarts with each session; database identity does not.
_Avoid_: run, stream, connection

## Demonstration

**3D Model**:
A browser-rendered three-dimensional model of the rig's sensor layout, driven
live by a physical ESP32 belt-monitor node's vibration and LDR readings over
a dedicated Supabase project — separate from the belt pipeline's session,
detection, track and incident model described above. Shows sensor placement
and mechanism (lasers, LDR array, accelerometer) with real motion and
rupture visuals bound to that node's own readings, not to the camera-based
detector. A rupture shown here reflects the ESP32's status/LDR logic, not a
confirmed, camera-detected incident — it is not interchangeable with what the
`Live monitor` tab reports.
_Avoid_: digital twin, camera feed, incident, detection

**Belt-monitor node**:
The ESP32 board mounted on the rig, carrying an accelerometer and an LDR array.
It writes readings to its own Supabase project and takes no commands back — the
3D Model can watch it, never drive it.
_Avoid_: sensor, controller, device, IoT node

**Reading**:
One row from the belt-monitor node — vibration, raw LDR, light percentage and
the node's own status — at roughly one a second. The sensor-side counterpart of
a detection, and equally ephemeral.
_Avoid_: sample, measurement, telemetry, datapoint

**Node status**:
The `NORMAL` or `WARNING` field the node computes onboard and stamps on each
reading. Distinct from severity: it is the node's own verdict about light
reaching the LDR array, owing nothing to the detector or the incident engine.
_Avoid_: severity, alarm, state

## Training and data

**Rig**:
The physical prototype conveyor this project demonstrates on, as distinguished
from the industrial belts in public datasets. The two look almost nothing alike.
See 3D Model for the rendered view of this same rig.
_Avoid_: prototype, test bench, model belt

**Negative**:
An image deliberately kept in a dataset because it contains *no* defect. It
teaches the detector what an undamaged belt looks like, and is as much a label
as a box is.
_Avoid_: empty image, background, blank, unlabelled

**Excluded image**:
An image removed from a dataset by choice — an unusable take, or a camera angle
that will never be deployed. Distinct from an unreviewed one.
_Avoid_: skipped, rejected, discarded

**Seed set**:
A small, deliberately varied subset labelled by hand first, used to train a
model that pre-labels everything else.
_Avoid_: sample, subset, initial batch

**Field test**:
Evaluation on footage that appears in no dataset split, scored by how much of a
real clip the model handles. The honest measure of whether a model works, as
opposed to validation metrics computed on data drawn from the same source as
training.
_Avoid_: benchmark, real-world test, smoke test
