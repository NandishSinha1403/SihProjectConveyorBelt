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
    hex: "#94a3b8",
    text: "text-sev-info",
    bg: "bg-sev-info/10",
    border: "border-sev-info/30",
    dot: "bg-sev-info",
  },
  low: {
    label: "Low",
    hex: "#60c4de",
    text: "text-sev-low",
    bg: "bg-sev-low/10",
    border: "border-sev-low/30",
    dot: "bg-sev-low",
  },
  medium: {
    label: "Medium",
    hex: "#fabe40",
    text: "text-sev-medium",
    bg: "bg-sev-medium/10",
    border: "border-sev-medium/30",
    dot: "bg-sev-medium",
  },
  high: {
    label: "High",
    hex: "#ff8030",
    text: "text-sev-high",
    bg: "bg-sev-high/10",
    border: "border-sev-high/30",
    dot: "bg-sev-high",
  },
  critical: {
    label: "Critical",
    hex: "#f53c3c",
    text: "text-sev-critical",
    bg: "bg-sev-critical/10",
    border: "border-sev-critical/40",
    dot: "bg-sev-critical",
  },
};

/** Weight each severity contributes to the belt health deduction. */
const HEALTH_WEIGHT: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 4,
  high: 12,
  critical: 30,
};

/**
 * A 0-100 belt health index from the severity mix seen so far.
 *
 * This is an interim heuristic for the vision module alone. The predictive
 * phase replaces it with a model that also weighs defect growth rate and
 * sensor anomalies -- see the architecture notes in the README.
 */
export function beltHealth(bySeverity: Partial<Record<Severity, number>>): number {
  const penalty = (Object.entries(bySeverity) as [Severity, number][]).reduce(
    (sum, [sev, n]) => sum + (HEALTH_WEIGHT[sev] ?? 0) * n,
    0,
  );
  // Diminishing returns: the tenth scratch matters far less than the first.
  // The divisor is tuned so that a shift with a couple of critical defects
  // reads "Degraded" rather than bottoming out -- a gauge that pins at zero
  // and stays there stops carrying information.
  return Math.max(0, Math.round(100 * Math.exp(-penalty / 120)));
}

export function healthLabel(score: number): { text: string; severity: Severity } {
  if (score >= 85) return { text: "Healthy", severity: "info" };
  if (score >= 65) return { text: "Monitor", severity: "low" };
  if (score >= 40) return { text: "Degraded", severity: "medium" };
  if (score >= 20) return { text: "At Risk", severity: "high" };
  return { text: "Critical", severity: "critical" };
}
