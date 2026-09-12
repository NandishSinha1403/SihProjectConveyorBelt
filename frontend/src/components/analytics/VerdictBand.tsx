import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Panel, Skeleton } from "@/components/ui/primitives";
import { BAND_SEVERITY, SEVERITY_META } from "@/lib/severity";
import type { ReliabilityIndex } from "@/lib/types";
import { formatSpan, type Corroboration, type MotionSummary } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * The headline: Reliability Yield, and the three figures that qualify it.
 *
 * Condition is deliberately not shown alone. A belt with no defects and a belt
 * nobody looked at both produce a perfect condition score, and only coverage
 * separates them -- so coverage sits beside the number rather than in a panel
 * further down where it can be missed.
 */
export function VerdictBand({
  index,
  motion,
  corroboration,
  loading,
}: {
  index: ReliabilityIndex | null;
  motion: MotionSummary;
  corroboration: Corroboration;
  loading: boolean;
}) {
  if (loading || !index) {
    return (
      <Panel className="px-5 py-6">
        <Skeleton className="h-[132px] w-full" />
      </Panel>
    );
  }

  const meta = SEVERITY_META[BAND_SEVERITY[index.band] ?? "info"];
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dash = (index.condition / 100) * circumference;

  // Low coverage does not change the score, but it does change how much the
  // score is worth, and the page has to say so.
  const thinCoverage = index.coverage !== null && index.coverage < 85;

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-8 px-5 py-6">
        <div className="relative shrink-0">
          <svg width="128" height="128" viewBox="0 0 128 128" aria-hidden>
            <circle cx="64" cy="64" r={radius} fill="none"
              stroke="var(--color-ash)" strokeWidth="1" />
            <circle
              cx="64" cy="64" r={radius} fill="none" stroke={meta.hex}
              strokeWidth="1" strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              transform="rotate(-90 64 64)"
              style={{ transition: "stroke-dasharray 0.5s var(--ease-focus)" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="tnum text-[2.75rem] leading-none tracking-[-0.03em] text-bone">
              {index.condition}
            </span>
            <span className="mt-1.5 text-[0.6875rem] uppercase tracking-[0.08em]"
              style={{ color: meta.hex }}>
              {index.band}
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[0.6875rem] uppercase tracking-[0.1em] text-signal-dim">
            Reliability Yield
          </p>
          <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-fog">
            <span className="text-bone">{index.distinct_defects}</span> distinct{" "}
            {index.distinct_defects === 1 ? "defect" : "defects"} on the belt,
            from <span className="text-bone">{index.incident_rows}</span>{" "}
            camera {index.incident_rows === 1 ? "sighting" : "sightings"}.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Figure
              label="Coverage"
              value={index.coverage === null ? "—" : `${index.coverage}%`}
              tone={index.coverage === null ? "muted" : thinCoverage ? "warn" : "good"}
              hint={
                index.coverage === null
                  ? "No frames read in this window"
                  : `${index.frames.frames_skipped.toLocaleString()} frames never analysed`
              }
            />
            <Figure
              label="Corroboration"
              value={
                corroboration.noSensorData
                  ? "No data"
                  : corroboration.agreement === null
                    ? "—"
                    : `${corroboration.agreement}%`
              }
              tone={corroboration.noSensorData ? "muted" : "default"}
              hint={
                corroboration.noSensorData
                  ? "The belt-monitor node reported nothing — not a disagreement"
                  : `${corroboration.matched} of ${corroboration.matched + corroboration.cameraOnly} rupture-class defects also seen by the optical sensor`
              }
            />
            <Figure
              label="Belt running"
              value={motion.unknown ? "—" : `${Math.round(motion.dutyCycle * 100)}%`}
              tone="default"
              hint={
                motion.unknown
                  ? "No vibration data for this window"
                  : `${formatSpan(motion.runningHours)} of motion out of ${formatSpan(motion.observedHours)} observed`
              }
            />
            <Trend value={index.trend} />
          </div>
        </div>
      </div>

      {thinCoverage && (
        <p className="border-t border-ash/70 px-5 py-3 text-[0.75rem] leading-relaxed text-sev-medium">
          This verdict rests on {index.coverage}% inspection coverage. Frames
          that arrived while the detector was busy were never analysed, so belt
          passed the camera unseen — treat the score as a floor, not a survey.
        </p>
      )}
    </Panel>
  );
}

function Figure({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "muted";
}) {
  return (
    <div className="min-w-0" title={hint}>
      <div className="text-[0.6875rem] uppercase tracking-[0.08em] text-fog">
        {label}
      </div>
      <div
        className={cn(
          "tnum mt-1 truncate text-[1.375rem] leading-none",
          tone === "default" && "text-bone",
          tone === "good" && "text-ok",
          tone === "warn" && "text-sev-medium",
          tone === "muted" && "text-fog",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** Trend, with "no trend" rendered as its own state rather than as zero. */
function Trend({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <div className="min-w-0" title="Not enough defects in both halves of the window to compare">
        <div className="text-[0.6875rem] uppercase tracking-[0.08em] text-fog">
          Trend
        </div>
        <div className="tnum mt-1 truncate text-[1.375rem] leading-none text-fog">
          —
        </div>
      </div>
    );
  }

  const flat = Math.abs(value) < 5;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="min-w-0" title="Change in condition, first half of the window against the second">
      <div className="text-[0.6875rem] uppercase tracking-[0.08em] text-fog">
        Trend
      </div>
      <div
        className={cn(
          "tnum mt-1 flex items-center gap-1 truncate text-[1.375rem] leading-none",
          flat ? "text-fog" : value > 0 ? "text-ok" : "text-sev-high",
        )}
      >
        <Icon size={18} strokeWidth={1.5} />
        {value > 0 ? `+${value}` : value}
      </div>
    </div>
  );
}
