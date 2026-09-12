import type {
  DistinctDefect,
  GeometryResponse,
  ReliabilityIndex,
  Severity,
  TimeseriesResponse,
} from "./types";
import type { ReadingSample, RuptureEvent } from "./rig/useBeltHistory";

/**
 * Where the two sensing channels meet.
 *
 * The camera pipeline and the ESP32 belt-monitor node watch the *same physical
 * belt*, which is what makes everything in this file legitimate: comparing
 * them is comparing two instruments trained on one subject, not conflating two
 * unrelated readings. What must never be conflated is their *verdicts* -- the
 * node's NORMAL/WARNING is its own onboard LDR threshold, not the pipeline's
 * confirmed, severity-scored incident.
 *
 * This join lives in the browser rather than the backend because the two
 * datasets live in two different Supabase projects, and only the browser holds
 * credentials for the rig's.
 */

/**
 * Tolerance when matching a camera incident against a sensor event.
 *
 * `incidents.opened_at` comes from `time.time()` on the API host; a reading's
 * `created_at` is stamped by Supabase's `now()`. Two clocks, never synchronised
 * to each other, plus a confirmation delay of CONFIRM_FRAMES before an incident
 * even opens. Five seconds is generous enough to survive that and still tight
 * enough that a match means something. It is surfaced in the UI, because a
 * correlation quoted without its tolerance is a correlation you cannot check.
 */
export const CORRELATION_TOLERANCE_MS = 5000;

/**
 * Vibration above which the belt is considered to be running.
 *
 * Matches MOTION_THRESHOLD in lib/rig/conveyor-model.ts, which is what the 3D
 * model already uses to decide whether to animate the belt at all. The two must
 * agree: a page reporting the belt as running while the model shows it stopped
 * is reporting on something other than the belt.
 */
export const MOTION_THRESHOLD = 0.12;

/** Classes that describe a rupture, and so could plausibly let light through. */
const RUPTURE_CLASSES = new Set(["joint_damage", "hole", "tear"]);

/* -- Running time --------------------------------------------------------- */

export interface MotionSummary {
  /** Hours the belt actually spent moving, from the vibration trace. */
  runningHours: number;
  /** Hours covered by the readings we have. */
  observedHours: number;
  /** Fraction of observed time the belt was moving, 0..1. */
  dutyCycle: number;
  /** True when there are no readings to judge from. */
  unknown: boolean;
}

/**
 * How long the belt was actually running, from the vibration trace.
 *
 * This is the correction the vision channel cannot make on its own. Defect
 * rate per wall-clock hour is meaningless if the belt stood still for most of
 * the window; per *running* hour is a figure you can compare between shifts.
 */
export function motionSummary(readings: ReadingSample[]): MotionSummary {
  if (readings.length < 2) {
    return { runningHours: 0, observedHours: 0, dutyCycle: 0, unknown: true };
  }

  let runningMs = 0;
  let observedMs = 0;
  for (let i = 1; i < readings.length; i += 1) {
    const dt = readings[i].t - readings[i - 1].t;
    // A gap far larger than the ~1s post interval means the node was offline,
    // not that the belt ran unobserved. Counting it either way would be a
    // guess, so it is counted as neither.
    if (dt <= 0 || dt > 15000) continue;
    observedMs += dt;
    // Trailing edge: the sample at the end of an interval describes it.
    if (readings[i].vibration > MOTION_THRESHOLD) runningMs += dt;
  }

  const observedHours = observedMs / 3_600_000;
  const runningHours = runningMs / 3_600_000;
  return {
    runningHours,
    observedHours,
    dutyCycle: observedMs > 0 ? runningMs / observedMs : 0,
    unknown: observedMs === 0,
  };
}

/* -- Corroboration -------------------------------------------------------- */

export interface Corroboration {
  /** Rupture-class defects the sensor also flagged, within tolerance. */
  matched: number;
  /** Rupture-class defects the camera saw alone. */
  cameraOnly: number;
  /** Sensor rupture events with no camera defect nearby. */
  sensorOnly: number;
  /** matched / (matched + cameraOnly), as a percentage. Null when nothing to score. */
  agreement: number | null;
  /** True when the rig channel produced no data at all in this window. */
  noSensorData: boolean;
}

/**
 * Agreement between the camera and the optical sensor over one window.
 *
 * Only rupture-class defects are scored. A scratch does not let light through
 * the belt, so the LDR array has no opinion about one, and counting the sensor
 * as having "missed" it would slander a working instrument.
 *
 * `noSensorData` exists because "the sensor agreed with nothing" and "there was
 * no sensor" are completely different findings, and rendering the second as 0%
 * would tell an engineer the hardware disagrees when in fact it was unplugged.
 */
export function corroborate(
  defects: DistinctDefect[],
  events: RuptureEvent[],
  readings: ReadingSample[],
  toleranceMs: number = CORRELATION_TOLERANCE_MS,
): Corroboration {
  const relevant = defects.filter((d) => RUPTURE_CLASSES.has(d.cls));

  if (readings.length === 0 && events.length === 0) {
    return {
      matched: 0,
      cameraOnly: relevant.length,
      sensorOnly: 0,
      agreement: null,
      noSensorData: true,
    };
  }

  const usedEvents = new Set<number>();
  let matched = 0;

  for (const d of relevant) {
    // A defect is "seen" from when it opened to when it was last observed;
    // a sensor event anywhere in that span, plus tolerance at each end, is a
    // match.
    const from = d.first_seen * 1000 - toleranceMs;
    const to = d.last_seen * 1000 + toleranceMs;
    const hit = events.findIndex(
      (e, i) => !usedEvents.has(i) && e.t >= from && e.t <= to,
    );
    if (hit >= 0) {
      usedEvents.add(hit);
      matched += 1;
    }
  }

  const cameraOnly = relevant.length - matched;
  const sensorOnly = events.length - usedEvents.size;
  const scored = matched + cameraOnly;

  return {
    matched,
    cameraOnly,
    sensorOnly,
    agreement: scored > 0 ? Math.round((100 * matched) / scored) : null,
    noSensorData: false,
  };
}

/* -- Belt revolution period ----------------------------------------------- */

export interface PeriodEstimate {
  /** Seconds per revolution, or null when no periodicity stands out. */
  seconds: number | null;
  /** Peak autocorrelation, 0..1. Below ~0.3 the estimate is not worth showing. */
  strength: number;
}

/**
 * Estimate the belt's revolution period from vibration periodicity.
 *
 * A belt is a loop, so anything on it -- the splice above all -- passes the
 * sensor once per revolution and leaves a repeating signature in the
 * accelerometer trace. Autocorrelation finds the lag at which the trace best
 * resembles itself.
 *
 * This is an *estimate* and is labelled as one wherever it is shown. It is
 * offered as supporting evidence for the deduplication heuristic, never as a
 * measured constant.
 */
export function estimatePeriod(
  readings: ReadingSample[],
  minSeconds = 2,
  maxSeconds = 120,
): PeriodEstimate {
  const moving = readings.filter((r) => r.vibration > MOTION_THRESHOLD);
  if (moving.length < 30) return { seconds: null, strength: 0 };

  const mean = moving.reduce((a, r) => a + r.vibration, 0) / moving.length;
  const series = moving.map((r) => r.vibration - mean);

  const variance = series.reduce((a, v) => a + v * v, 0);
  if (variance <= 0) return { seconds: null, strength: 0 };

  // Samples arrive at roughly 1 Hz, so a lag in samples is a lag in seconds.
  const maxLag = Math.min(maxSeconds, Math.floor(series.length / 2));
  let bestLag = 0;
  let best = 0;

  for (let lag = minSeconds; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < series.length; i += 1) {
      sum += series[i] * series[i + lag];
    }
    const norm = sum / variance;
    if (norm > best) {
      best = norm;
      bestLag = lag;
    }
  }

  if (best < 0.3 || bestLag === 0) return { seconds: null, strength: best };
  return { seconds: bestLag, strength: Math.min(1, best) };
}

/* -- Chart shaping -------------------------------------------------------- */

export interface FusionPoint {
  t: number;
  vibration: number | null;
  vibrationMax: number | null;
  lightPercent: number | null;
  warning: number;
  incidents: number;
  critical: number;
}

/**
 * One row per time bucket carrying both channels, for the fusion timeline.
 *
 * The two sources are bucketed onto a shared grid rather than plotted on their
 * own axes, because the entire point of the chart is that a viewer can read
 * down a vertical line and see what each instrument said at that moment.
 */
export function buildFusionSeries(
  timeseries: TimeseriesResponse | null,
  readings: Array<ReadingSample & { vibrationMax?: number }>,
  bucketMs: number,
): FusionPoint[] {
  const grid = new Map<number, FusionPoint>();

  const at = (t: number): FusionPoint => {
    const key = Math.floor(t / bucketMs) * bucketMs;
    let point = grid.get(key);
    if (!point) {
      point = {
        t: key,
        vibration: null,
        vibrationMax: null,
        lightPercent: null,
        warning: 0,
        incidents: 0,
        critical: 0,
      };
      grid.set(key, point);
    }
    return point;
  };

  for (const r of readings) {
    const p = at(r.t);
    p.vibration = r.vibration;
    p.vibrationMax = r.vibrationMax ?? r.vibration;
    p.lightPercent = r.lightPercent;
    if (r.status === "WARNING") p.warning = 1;
  }

  for (const item of timeseries?.items ?? []) {
    const p = at(item.bucket * 1000);
    p.incidents += item.n;
    if (item.severity === "critical") p.critical += item.n;
  }

  return [...grid.values()].sort((a, b) => a.t - b.t);
}

/* -- Smart summary -------------------------------------------------------- */

export interface SummaryInput {
  index: ReliabilityIndex | null;
  geometry: GeometryResponse | null;
  motion: MotionSummary;
  corroboration: Corroboration;
  period: PeriodEstimate;
}

/**
 * A short plain-English reading of the window.
 *
 * Every sentence is switched on by a threshold over a value that was actually
 * computed; nothing here is a template with a number dropped into it, and
 * there is no language model involved. When the data does not support a
 * claim the sentence is simply not emitted, so a thin window produces a short
 * summary rather than a confident-sounding empty one.
 */
export function buildSummary({
  index,
  geometry,
  motion,
  corroboration,
  period,
}: SummaryInput): string[] {
  const out: string[] = [];
  if (!index) return out;

  const { distinct_defects: distinct, incident_rows: rows } = index;

  if (distinct === 0) {
    out.push(
      index.frames.frames_read === 0
        ? "No footage was processed in this window, so the belt's condition is unknown — this is not a clean bill of health."
        : "No defects were confirmed in this window.",
    );
  } else {
    const critical = index.distinct_by_severity.critical ?? 0;
    const hours = motion.unknown ? index.observed_hours : motion.runningHours;
    const basis = motion.unknown
      ? `${formatSpan(index.observed_hours)} of monitoring`
      : `${formatSpan(hours)} of belt motion`;
    out.push(
      `Over ${basis}, ${distinct} distinct ${distinct === 1 ? "defect was" : "defects were"} confirmed` +
        (critical > 0
          ? `, of which ${critical} ${critical === 1 ? "is" : "are"} critical.`
          : "."),
    );
  }

  // The recurrence correction is worth stating explicitly: it is the single
  // biggest difference between this page and the raw incident count, and an
  // engineer comparing the two needs to know why they disagree.
  if (rows > distinct && distinct > 0) {
    out.push(
      `The camera logged ${rows} sightings of those ${distinct}; the belt is a loop, so a defect returns past the lens once per revolution.` +
        (period.seconds
          ? ` Vibration periodicity puts that revolution at about ${period.seconds}s.`
          : ""),
    );
  }

  // Lateral clustering is a mechanical finding, and the most actionable thing
  // on the page: it points at the rollers, not at the belt surface.
  if (geometry && geometry.measured >= 5 && geometry.lateral_mean !== null &&
      geometry.lateral_stdev !== null && geometry.lateral_stdev < 0.15) {
    const pct = Math.round(geometry.lateral_mean * 100);
    const side = pct < 40 ? "one edge" : pct > 60 ? "the far edge" : "the centre";
    out.push(
      `Defects cluster around ${pct}% of belt width (${side}), rather than spreading across it — a pattern that usually points at belt tracking or roller alignment rather than at the belt surface itself.`,
    );
  }

  if (corroboration.noSensorData) {
    out.push(
      "The belt-monitor node reported nothing in this window, so these findings rest on the camera alone.",
    );
  } else if (corroboration.agreement !== null) {
    out.push(
      `The optical sensor independently flagged ${corroboration.matched} of ${corroboration.matched + corroboration.cameraOnly} rupture-class defects (${corroboration.agreement}% agreement)` +
        (corroboration.sensorOnly > 0
          ? `, and raised ${corroboration.sensorOnly} further ${corroboration.sensorOnly === 1 ? "event" : "events"} the camera did not confirm.`
          : "."),
    );
  }

  // Coverage last, because it qualifies everything above it.
  if (index.coverage !== null && index.coverage < 85) {
    out.push(
      `Inspection coverage was ${index.coverage}% — ${index.frames.frames_skipped.toLocaleString()} frames arrived while the detector was busy and were never analysed, so some belt passed unseen.`,
    );
  }

  if (index.trend !== null && Math.abs(index.trend) >= 5) {
    out.push(
      index.trend < 0
        ? `Condition deteriorated by ${Math.abs(index.trend)} points across the window.`
        : `Condition improved by ${index.trend} points across the window.`,
    );
  }

  return out;
}

/**
 * A duration in hours, written the way someone would say it.
 *
 * A rig session is minutes long, and `0.0h` reads as "no time at all" when the
 * run was a perfectly good forty seconds.
 */
export function formatSpan(hours: number): string {
  const seconds = hours * 3600;
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${hours.toFixed(1)}h`;
}

/** Severity ordering for stacked charts: worst on top. */
export const STACK_ORDER: Severity[] = ["info", "low", "medium", "high", "critical"];
