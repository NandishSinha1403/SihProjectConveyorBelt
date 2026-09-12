import { BAND_SEVERITY, SEVERITY_META } from "@/lib/severity";
import type { ReliabilityIndex, Severity } from "@/lib/types";
import { Panel, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/components/Router";

// belt_joint never opens an incident, so it can never appear here.
const CLASS_ORDER = ["joint_damage", "tear", "hole", "crack", "scratch"];

/**
 * Reliability Yield on the Monitor tab, and the two breakdowns that explain it.
 *
 * This was "Belt health", scored by `beltHealth()` over raw incident rows. That
 * function is gone: a belt is a loop, so one tear opened a fresh incident every
 * revolution and was penalised again each time, which on real footage pinned
 * the gauge at 0 while Analytics -- reading the same window -- showed 40. Two
 * numbers that disagree about the same belt are worse than one that is wrong,
 * so both surfaces now read the single index from
 * `/api/analytics/reliability`. See docs/adr/0009.
 *
 * This is the compact form; the Analytics tab holds the auditable version with
 * the per-defect register behind it.
 */
export function ReliabilityPanel({ index }: { index: ReliabilityIndex | null }) {
  if (!index) {
    return (
      <Panel>
        <PanelHeader title="Reliability Yield" />
        <Skeleton className="m-4 h-[168px]" />
      </Panel>
    );
  }

  const meta = SEVERITY_META[BAND_SEVERITY[index.band] ?? "info"];
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dash = (index.condition / 100) * circumference;

  const bySeverity = index.distinct_by_severity;
  const severityRows = (["critical", "high", "medium", "low"] as Severity[])
    .map((sev) => ({ sev, count: bySeverity[sev] ?? 0 }))
    .filter((r) => r.count > 0);

  const classCounts = new Map<string, { label: string; count: number }>();
  for (const d of index.defects) {
    const entry = classCounts.get(d.cls);
    if (entry) entry.count += 1;
    else classCounts.set(d.cls, { label: d.label, count: 1 });
  }
  const classRows = CLASS_ORDER.filter((cls) => classCounts.has(cls)).map(
    (cls) => ({ cls, ...classCounts.get(cls)! }),
  );
  const classMax = Math.max(1, ...classRows.map((r) => r.count));

  const hours = index.window.hours;
  const thinCoverage = index.coverage !== null && index.coverage < 85;

  return (
    <Panel>
      <PanelHeader
        title={hours ? `Reliability Yield · last ${hours}h` : "Reliability Yield"}
        action={
          <Link
            to="/analytics"
            className="text-[0.75rem] text-fog transition-colors hover:text-signal"
          >
            Analytics →
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-6 px-4 py-5 sm:flex-nowrap">
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
          <p className="text-[0.8125rem] leading-relaxed text-fog">
            {index.distinct_defects === 0 ? (
              index.frames.frames_read === 0
                ? "No footage processed in this window — condition unknown."
                : "No defects confirmed in this window."
            ) : (
              <>
                <span className="text-bone">{index.distinct_defects}</span>{" "}
                distinct{" "}
                {index.distinct_defects === 1 ? "defect" : "defects"}, from{" "}
                <span className="text-bone">{index.incident_rows}</span>{" "}
                {index.incident_rows === 1 ? "sighting" : "sightings"}.
              </>
            )}
          </p>

          {/* Coverage rides with the score everywhere it appears. A clean belt
              and a belt nobody looked at both score 100; only this tells them
              apart. */}
          <p className="mt-2 text-[0.75rem] leading-relaxed text-fog">
            Inspection coverage{" "}
            <span className={thinCoverage ? "text-sev-medium" : "text-bone"}>
              {index.coverage === null ? "—" : `${index.coverage}%`}
            </span>
            {thinCoverage && " — some belt passed the camera unseen"}
          </p>

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
