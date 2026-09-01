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
