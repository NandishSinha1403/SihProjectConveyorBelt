import { beltHealth, healthLabel, SEVERITY_META } from "@/lib/severity";
import type { Severity } from "@/lib/types";
import { Panel, PanelHeader } from "@/components/ui/primitives";

/**
 * Belt Health Index.
 *
 * Scale carries the hierarchy here rather than weight: the number is set large
 * and light, the way the reference sets its display type. The ring is a single
 * hairline arc — no fill, no glow.
 *
 * Vision-only for now. The deferred predictive phase folds in defect growth
 * rate and IoT sensor anomalies, which is why the contribution breakdown is a
 * list rather than a single opaque figure.
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

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;

  const rows = (["critical", "high", "medium", "low"] as Severity[])
    .map((sev) => ({ sev, count: bySeverity[sev] ?? 0 }))
    .filter((r) => r.count > 0);

  return (
    <Panel>
      <PanelHeader
        title={windowHours ? `Belt health · last ${windowHours}h` : "Belt health"}
      />
      <div className="flex flex-wrap items-center gap-6 px-4 py-5 sm:flex-nowrap">
        <div className="relative shrink-0">
          <svg width="128" height="128" viewBox="0 0 128 128" aria-hidden>
            <circle
              cx="64"
              cy="64"
              r={radius}
              fill="none"
              stroke="var(--color-ash)"
              strokeWidth="1"
            />
            <circle
              cx="64"
              cy="64"
              r={radius}
              fill="none"
              stroke={meta.hex}
              strokeWidth="1"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              transform="rotate(-90 64 64)"
              style={{ transition: "stroke-dasharray 0.5s var(--ease-focus)" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="tnum text-[2.75rem] leading-none tracking-[-0.03em] text-bone">
              {score}
            </span>
            <span
              className="mt-1.5 text-[0.6875rem] uppercase tracking-[0.08em]"
              style={{ color: meta.hex }}
            >
              {text}
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] leading-relaxed text-fog">
            {total === 0
              ? "No confirmed defects in this window."
              : `${total} confirmed defect${total === 1 ? "" : "s"} in this window.`}
            {allTime !== undefined && allTime !== total && (
              <span className="text-fog/60"> {allTime} all time.</span>
            )}
          </p>

          {/* A gauge pinned at zero reads as broken unless it says why. */}
          {score === 0 && total > 0 && (
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-sev-critical">
              The index bottoms out at zero once this many serious defects are
              on record — the belt needs inspection, not a finer score.
            </p>
          )}

          {rows.length > 0 && (
            <ul className="mt-4 space-y-2">
              {rows.map(({ sev, count }) => {
                const m = SEVERITY_META[sev];
                return (
                  <li
                    key={sev}
                    className="flex items-center gap-2.5 text-[0.8125rem]"
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: m.hex }}
                    />
                    <span className="flex-1 text-fog">{m.label}</span>
                    <span className="tnum text-bone">{count}</span>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-5 border-t border-ash/70 pt-3 text-[0.75rem] leading-relaxed text-fog/70">
            Vision-derived. Sensor and wear-rate inputs join in the predictive
            phase.
          </p>
        </div>
      </div>
    </Panel>
  );
}
