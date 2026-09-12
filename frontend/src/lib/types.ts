export type Severity = "info" | "low" | "medium" | "high" | "critical";

export const SEVERITY_ORDER: Severity[] = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
];

export interface DetectionBox {
  cls: string;
  label: string;
  confidence: number;
  severity: Severity;
  track_id: number | null;
  /** Normalised [x1, y1, x2, y2] in 0..1, so the client can scale freely. */
  box: [number, number, number, number];
  box_px: [number, number, number, number];
}

export interface StreamStatus {
  running: boolean;
  uri: string | null;
  label: string | null;
  kind?: string;
  is_live?: boolean;
  source_fps?: number;
  width?: number;
  height?: number;
  detector: string | null;
  started_at?: number;
  uptime?: number;
  capture_fps: number;
  inference_fps: number;
  inference_ms?: number;
  frames_read?: number;
  frames_processed?: number;
  frames_skipped: number;
  clahe?: boolean;
  open_incidents?: number;
  counts: Record<string, number>;
  error?: string | null;
  ended?: boolean;
}

export interface FrameEvent {
  frame_id: number;
  timestamp: number;
  width: number;
  height: number;
  detections: DetectionBox[];
  inference_ms: number;
  stats: StreamStatus;
}

export interface Incident {
  id: number;
  track_id: number;
  cls: string;
  label: string;
  severity: Severity;
  confidence: number;
  opened_at: number;
  closed_at: number | null;
  duration: number;
  first_frame: number;
  last_frame: number;
  snapshot: string | null;
  box: number[];
}

export interface VideoInfo {
  name: string;
  uri: string;
  size_bytes: number;
  duration: number;
  fps: number;
  width: number;
  height: number;
  frame_count: number;
}

export interface DeviceInfo {
  index: number;
  uri: string;
  label: string;
  width: number;
  height: number;
}

export interface IncidentSummary {
  total: number;
  all_time: number;
  window_hours: number | null;
  by_class: Record<string, { label: string; count: number }>;
  by_severity: Partial<Record<Severity, number>>;
  open: Incident[];
  classes: Record<string, string>;
}

export interface RuntimeSettings {
  enable_clahe: boolean;
  conf_threshold: number;
  iou_threshold: number;
  max_stream_fps: number;
  confirm_frames: number;
  incident_confidence_threshold: number;
  detector: string;
  model_path: string;
  img_size: number;
  device: string;
}

export type WsMessage =
  | { type: "stream.status"; data: StreamStatus }
  | { type: "frame"; data: FrameEvent }
  | { type: "incident.opened"; data: Incident }
  | { type: "incident.updated"; data: Incident }
  | { type: "incident.closed"; data: Incident };

/* -- Analytics ------------------------------------------------------------
   Shapes returned by /api/analytics/*. The corroboration term is absent from
   every backend payload on purpose: the ESP32 node writes to a separate
   Supabase project that only the browser holds credentials for, so the two
   channels are joined client-side in lib/analytics.ts.
------------------------------------------------------------------------- */

export interface SessionRow {
  id: number;
  source_uri: string;
  source_kind: string;
  label: string;
  detector: string;
  started_at: number;
  ended_at: number | null;
  frames_read: number;
  frames_processed: number;
  frames_skipped: number;
  incident_count: number;
  critical_count: number;
  is_live: boolean;
}

/** One physical defect, after repeat sightings across belt revolutions merge. */
export interface DistinctDefect {
  cls: string;
  label: string;
  severity: Severity;
  confidence: number;
  /** Position across belt width, 0..1. Null when the row had no usable box. */
  lateral: number | null;
  /** Fraction of frame area. */
  area: number;
  /** How many incident rows resolved to this one defect. */
  sightings: number;
  first_seen: number;
  last_seen: number;
  penalty: number;
  incident_ids: number[];
}

export interface ReliabilityIndex {
  condition: number;
  band: string;
  penalty: number;
  defects_per_hour: number;
  /** Null when no frames were read — which is not the same as 0%. */
  coverage: number | null;
  /** Positive means improving. Null when there is nothing to compare. */
  trend: number | null;
  observed_hours: number;
  incident_rows: number;
  distinct_defects: number;
  distinct_by_severity: Partial<Record<Severity, number>>;
  defects: DistinctDefect[];
  corroboration: null;
  window: {
    start: number;
    end: number;
    hours: number | null;
    session_id: number | null;
  };
  frames: {
    frames_read: number;
    frames_processed: number;
    frames_skipped: number;
  };
  sessions: number;
}

export interface TimeseriesBucket {
  bucket: number;
  severity: Severity;
  cls: string;
  n: number;
}

export interface TimeseriesResponse {
  start: number;
  end: number;
  bucket_seconds: number;
  items: TimeseriesBucket[];
  classes: Record<string, string>;
}

export interface GeometryPoint {
  id: number;
  cls: string;
  severity: Severity;
  confidence: number;
  lateral: number;
  area: number;
  aspect: number;
  opened_at: number;
}

export interface GeometryResponse {
  measured: number;
  total_rows: number;
  lateral_bins: number;
  lateral: number[];
  area_edges: number[];
  area: number[];
  longitudinal: number;
  lateral_mean: number | null;
  lateral_stdev: number | null;
  scatter: GeometryPoint[];
}
