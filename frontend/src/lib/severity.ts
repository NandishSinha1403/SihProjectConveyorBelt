import type { Severity } from "./types";

/**
 * Severity presentation. The hex values match the BGR colours the backend draws
 * onto annotated frames, so a box on the video and its card in the alert rail
 * are always the same colour.
 */
export const SEVERITY_META: Record<
  Severity,
  { label: string; hex: string; text: string; bg: string; border: string; dot: string }
> = {
  info: {
    label: "Info",
    hex: "#6f879c",
    text: "text-sev-info",
    bg: "bg-sev-info/10",
    border: "border-sev-info/30",
    dot: "bg-sev-info",
  },
  low: {
    label: "Low",
    hex: "#2a7fff",
    text: "text-sev-low",
    bg: "bg-sev-low/10",
    border: "border-sev-low/30",
    dot: "bg-sev-low",
  },
  medium: {
    label: "Medium",
    hex: "#f5c451",
    text: "text-sev-medium",
    bg: "bg-sev-medium/10",
    border: "border-sev-medium/30",
    dot: "bg-sev-medium",
  },
  high: {
    label: "High",
    hex: "#ff7a3d",
    text: "text-sev-high",
    bg: "bg-sev-high/10",
    border: "border-sev-high/30",
    dot: "bg-sev-high",
  },
  critical: {
    label: "Critical",
    hex: "#ff2a2a",
    text: "text-sev-critical",
    bg: "bg-sev-critical/10",
    border: "border-sev-critical/40",
    dot: "bg-sev-critical",
  },
};

/**
 * Score band to the severity token that colours it.
 *
 * The bands themselves are computed in `backend/app/analytics/reliability.py`;
 * this is only the mapping from a band's name to how it is drawn, so the
 * gauge on the Monitor tab and the verdict on Analytics tint identically.
 */
export const BAND_SEVERITY: Record<string, Severity> = {
  Healthy: "info",
  Monitor: "low",
  Degraded: "medium",
  "At Risk": "high",
  Critical: "critical",
};
