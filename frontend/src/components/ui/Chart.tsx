import type { ReactNode } from "react";
import { SEVERITY_META } from "@/lib/severity";
import type { Severity } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Shared chart chrome.
 *
 * Rule 1 of DESIGN.md -- use the tokens, never raw colours -- applies to charts
 * as much as to anything else, and a charting library is the classic place for
 * a stray `#8884d8` to creep in. Every axis, grid line and tooltip in the app
 * takes its colours from here, and here alone.
 *
 * The values are `var(--color-*)` strings rather than resolved hex, because SVG
 * `stroke` and `fill` accept custom properties directly. That means a chart
 * repaints correctly when the theme flips, without re-rendering React or
 * re-reading computed styles.
 */

export const AXIS = {
  stroke: "var(--color-ash)",
  tick: {
    fill: "var(--color-fog)",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
  },
  tickLine: false,
  axisLine: { stroke: "var(--color-ash)" },
} as const;

export const GRID = {
  stroke: "var(--color-ash)",
  strokeOpacity: 0.55,
  vertical: false,
} as const;

/** Chrome that is not reporting a belt condition uses signal, never a severity hue. */
export const NEUTRAL_SERIES = "var(--color-fog)";
export const ACCENT_SERIES = "var(--color-signal)";

export function severityColor(severity: Severity): string {
  return SEVERITY_META[severity].hex;
}

/**
 * Tooltip body.
 *
 * Recharts' default tooltip is a white box with a drop shadow, which is wrong
 * in both themes and wrong for a design system whose depth is a surface step
 * plus a hairline, never a shadow.
 */
export function ChartTooltip({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: ReactNode; color?: string }>;
}) {
  return (
    <div className="rounded-[5px] border border-ash bg-panel px-3 py-2 shadow-none">
      <p className="mb-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.06em] text-fog">
        {title}
      </p>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2 text-[0.75rem]">
            {r.color && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: r.color }}
              />
            )}
            <span className="flex-1 text-fog">{r.label}</span>
            <span className="tnum text-bone">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A titled chart well.
 *
 * `note` is for the caveat that belongs *with* the chart rather than in a
 * footnote somewhere -- an estimate's tolerance, a clock skew, a heuristic.
 * Several charts on the analytics page are only honest with one attached.
 */
export function ChartPanel({
  title,
  subtitle,
  note,
  action,
  height = 240,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  note?: string;
  action?: ReactNode;
  height?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[15px] border border-ash/70 bg-panel", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-ash/70 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[0.8125rem] tracking-[0.02em] text-bone">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 truncate text-[0.75rem] text-fog">{subtitle}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      <div className="px-2 py-4" style={{ height }}>
        {children}
      </div>

      {note && (
        <p className="border-t border-ash/70 px-4 py-2.5 text-[0.6875rem] leading-relaxed text-fog">
          {note}
        </p>
      )}
    </div>
  );
}

/* -- Sparse data ----------------------------------------------------------
   The reason the first version of the analytics page read as meaningless: a
   20-bin histogram holding three bars, and a scatter of fourteen dots. Both
   were technically correct and told a reader nothing, because a distribution
   drawn from too few samples shows the sample, not the distribution.

   Every panel that draws a distribution declares a minimum n and falls back to
   this. Listing the values outright is not a degraded experience -- at n = 6 it
   is strictly more information than a chart of the same six numbers, and it
   never invites a reader to see structure that is not there.
------------------------------------------------------------------------- */

/** Below this many samples, a distribution is the sample. */
export const MIN_DISTRIBUTION_N = 12;

export function SparseValues({
  n,
  min = MIN_DISTRIBUTION_N,
  noun,
  rows,
}: {
  n: number;
  min?: number;
  /** What is being counted, e.g. "sightings". */
  noun: string;
  rows: Array<{ label: string; value: ReactNode; color?: string }>;
}) {
  return (
    <div className="flex h-full flex-col justify-center px-2">
      <p className="mb-3 text-[0.75rem] leading-relaxed text-fog">
        {n === 0 ? (
          <>Nothing recorded yet.</>
        ) : (
          <>
            <span className="tnum text-bone">n&nbsp;=&nbsp;{n}</span> {noun} — too
            few to read as a distribution, so the values are listed instead.
          </>
        )}
      </p>
      {rows.length > 0 && (
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center gap-2 text-[0.8125rem]">
              {r.color && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: r.color }}
                />
              )}
              <span className="min-w-0 flex-1 truncate text-fog">{r.label}</span>
              <span className="tnum shrink-0 text-bone">{r.value}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="sr-only">Minimum sample size for a chart here is {min}.</p>
    </div>
  );
}

/**
 * Cap the number of x-axis ticks.
 *
 * Recharts will happily label all twenty bins of a histogram, which is how the
 * belt-width chart ended up with an unreadable row of percentages.
 */
export function thinTicks<T>(values: T[], max = 8): T[] {
  if (values.length <= max) return values;
  const step = Math.ceil(values.length / max);
  return values.filter((_, i) => i % step === 0);
}
