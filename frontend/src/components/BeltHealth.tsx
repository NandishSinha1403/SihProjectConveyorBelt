import { beltHealth, healthLabel, SEVERITY_META } from "@/lib/severity";
import type { IncidentSummary, Severity } from "@/lib/types";
import { Panel, PanelHeader } from "@/components/ui/primitives";

const CLASS_ORDER = ["joint_damage", "tear", "hole", "crack", "scratch", "belt_joint"];

/**
 * Belt health, and the two breakdowns that explain it.
 *
 * This was three panels: a gauge over an eight-hour window, a per-class counter
 * over the session, and the alert rail. The first two told the same story in
 * two different time windows, so a tear could be counted once in one panel and
 * not the other — the contradiction was the tell that they should be one thing.
 * Both breakdowns now read from the same window as the score.
 *
 * Severity leads because it drives action; class follows because it explains.
 */
export function BeltHealth({ summary }: { summary: IncidentSummary | null }) {
  const bySeverity = summary?.by_severity ?? {};
  const total = summary?.total ?? 0;
  const score = beltHealth(bySeverity);
  const { text, severity } = healthLabel(score);
  const meta = SEVERITY_META[severity];

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;

  const severityRows = (["critical", "high", "medium", "low"] as Severity[])
    .map((sev) => ({ sev, count: bySeverity[sev] ?? 0 }))
    .filter((r) => r.count > 0);

  const byClass = summary?.by_class ?? {};
  const classRows = CLASS_ORDER.map((cls) => ({ cls, entry: byClass[cls] }))
    .filter((r) => r.entry && r.entry.count > 0)
    .map((r) => ({ cls: r.cls, label: r.entry!.label, count: r.entry!.count }));
  const classMax = Math.max(1, ...classRows.map((r) => r.count));

  return (
    <Panel>
      <PanelHeader
        title={
          summary?.window_hours
            ? `Belt health · last ${summary.window_hours}h`
            : "Belt health"
        }
      />

      <div className="flex flex-wrap items-center gap-6 px-4 py-5 sm:flex-nowrap">
        <div className="relative shrink-0">
          <svg width="128" height="128" viewBox="0 0 128 128" aria-hidden>
            <circle cx="64" cy="64" r={radius} fill="none"
              stroke="var(--color-ash)" strokeWidth="1" />
            <circle
              cx="64" cy="64" r={radius} fill="none"
              stroke={meta.hex} strokeWidth="1" strokeLinecap="round"
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
          </p>

          {score === 0 && total > 0 && (
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-sev-critical">
              The index bottoms out at zero once this many serious defects are on
              record — the belt needs inspection, not a finer score.
            </p>
          )}

          {severityRows.length > 0 && (
            <ul className="mt-4 space-y-2">
              {severityRows.map(({ sev, count }) => (
                <li key={sev} className="flex items-center gap-2.5 text-[0.8125rem]">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: SEVERITY_META[sev].hex }} />
                  <span className="flex-1 text-fog">{SEVERITY_META[sev].label}</span>
                  <span className="tnum text-bone">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {classRows.length > 0 && (
        <ul className="space-y-3 border-t border-ash/70 px-4 py-4">
          {classRows.map(({ cls, label, count }) => (
            <li key={cls}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="truncate text-[0.8125rem] text-fog">{label}</span>
                <span className="tnum text-[0.9375rem] text-bone">{count}</span>
              </div>
              <div className="h-px w-full bg-ash">
                <div
                  className="h-px origin-left bg-bone transition-transform duration-500 ease-[var(--ease-focus)]"
                  style={{ transform: `scaleX(${count / classMax})` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
