import { HeartPulse } from "lucide-react";
import { beltHealth, healthLabel, SEVERITY_META } from "@/lib/severity";
import type { Severity } from "@/lib/types";
import { Panel, PanelHeader } from "@/components/ui/primitives";

/**
 * Belt Health Index.
 *
 * Vision-only for now. The deferred predictive phase folds in defect growth
 * rate and IoT sensor anomalies, which is why the contribution breakdown is
 * rendered as a list rather than baked into a single opaque number.
 */
export function HealthGauge({
  bySeverity,
  total,
  allTime,
  windowHours,
}: {
  bySeverity: Partial<Record<Severity, number>>;
  total: number;
  allTime?: number;
  windowHours?: number | null;
}) {
  const score = beltHealth(bySeverity);
  const { text, severity } = healthLabel(score);
  const meta = SEVERITY_META[severity];

  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;

  const rows = (["critical", "high", "medium", "low"] as Severity[])
    .map((sev) => ({ sev, count: bySeverity[sev] ?? 0 }))
    .filter((r) => r.count > 0);

  return (
    <Panel>
      <PanelHeader
        title={
          windowHours
            ? `Belt Health Index — last ${windowHours}h`
            : "Belt Health Index"
        }
        icon={<HeartPulse size={13} />}
      />
      <div className="flex items-center gap-5 px-4 py-4">
        <div className="relative shrink-0">
          <svg width="124" height="124" viewBox="0 0 124 124" aria-hidden>
            <circle
              cx="62"
              cy="62"
              r={radius}
              fill="none"
              stroke="var(--color-line)"
              strokeWidth="8"
            />
            <circle
              cx="62"
              cy="62"
              r={radius}
              fill="none"
              stroke={meta.hex}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              transform="rotate(-90 62 62)"
              style={{ transition: "stroke-dasharray 0.6s ease" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="tnum text-3xl font-bold leading-none text-ink">
              {score}
            </span>
            <span
              className="mt-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: meta.hex }}
            >
              {text}
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs text-ink-faint">
            {total === 0
              ? "No confirmed defects in this window."
              : `${total} confirmed defect${total === 1 ? "" : "s"} in this window.`}
            {allTime !== undefined && allTime !== total && (
              <span className="text-ink-faint/70"> {allTime} all time.</span>
            )}
          </p>
          {rows.length > 0 && (
            <ul className="mt-2.5 space-y-1.5">
              {rows.map(({ sev, count }) => {
                const m = SEVERITY_META[sev];
                return (
                  <li key={sev} className="flex items-center gap-2 text-xs">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${m.dot}`} />
                    <span className="flex-1 text-ink-dim">{m.label}</span>
                    <span className="tnum font-semibold text-ink">{count}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 border-t border-line-soft pt-2 text-[10px] leading-relaxed text-ink-faint">
            Vision-derived score. Sensor and wear-rate inputs join in the
            predictive phase.
          </p>
        </div>
      </div>
    </Panel>
  );
}
