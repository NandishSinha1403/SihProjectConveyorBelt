import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AXIS,
  ChartPanel,
  ChartTooltip,
  GRID,
  MIN_DISTRIBUTION_N,
  SparseValues,
} from "@/components/ui/Chart";
import type { GeometryPoint } from "@/lib/types";

/**
 * How sure the detector was, across everything it logged.
 *
 * The question this answers is "should I believe the detector?", which the
 * scatter it replaces only gestured at. A population bunched just above the
 * incident bar is a different situation from one bunched at 0.9, and only the
 * second justifies acting without reviewing the evidence images.
 *
 * The **incident threshold** is drawn on it, read live from `/api/settings`
 * because an operator can move it from the Settings page.
 *
 * The detector's own threshold (0.35) is deliberately *not* drawn, and this is
 * the detail that keeps the chart honest. Detections between 0.35 and the
 * incident bar are rendered on the live stream but never advanced into a track,
 * so they never reach the incidents table. There is structurally no data below
 * the incident threshold. A reference line there would draw the eye to an empty
 * region and imply the detector found nothing, when in fact the pipeline
 * deliberately declined to record it -- see docs/adr/0008.
 */

const BIN_COUNT = 14;

export function ConfidenceDistribution({
  points,
  incidentThreshold,
}: {
  points: GeometryPoint[];
  /** Null until /api/settings answers. */
  incidentThreshold: number | null;
}) {
  const n = points.length;

  // Bin across the range that can actually contain data: the incident bar to 1.
  const floor = incidentThreshold ?? 0.5;
  const lo = Math.max(0, Math.min(floor, ...points.map((p) => p.confidence)));
  const hi = 1;
  const width = (hi - lo) / BIN_COUNT;

  const bins = Array.from({ length: BIN_COUNT }, (_, i) => ({
    mid: lo + (i + 0.5) * width,
    from: lo + i * width,
    to: lo + (i + 1) * width,
    n: 0,
  }));
  for (const p of points) {
    const idx = Math.min(
      BIN_COUNT - 1,
      Math.max(0, Math.floor((p.confidence - lo) / width)),
    );
    bins[idx].n += 1;
  }

  const note =
    incidentThreshold === null
      ? "Detections below the incident threshold are drawn on the live stream but never recorded, so this distribution necessarily starts at that bar."
      : `Nothing appears below ${incidentThreshold.toFixed(2)} because detections under the incident threshold are shown on the live feed but never written to the record — that band is declined on purpose, not missed by the detector.`;

  if (n < MIN_DISTRIBUTION_N) {
    const sorted = [...points].sort((a, b) => b.confidence - a.confidence);
    return (
      <ChartPanel
        title="Detector confidence"
        subtitle="How sure the model was, across every sighting"
        height={240}
        note={note}
      >
        <SparseValues
          n={n}
          noun="sightings"
          rows={sorted.slice(0, 8).map((p) => ({
            label: `Incident #${p.id}`,
            value: p.confidence.toFixed(2),
          }))}
        />
      </ChartPanel>
    );
  }

  const mean = points.reduce((a, p) => a + p.confidence, 0) / n;
  const nearBar = points.filter((p) => p.confidence < floor + 0.1).length;

  return (
    <ChartPanel
      title="Detector confidence"
      subtitle={`${n} sightings · mean ${mean.toFixed(2)} · ${Math.round((100 * nearBar) / n)}% within 0.10 of the bar`}
      height={240}
      note={note}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bins} margin={{ top: 8, right: 14, bottom: 4, left: -18 }}>
          <CartesianGrid {...GRID} />
          <XAxis
            dataKey="mid"
            type="number"
            domain={[lo, hi]}
            tickFormatter={(v: number) => v.toFixed(2)}
            {...AXIS}
          />
          <YAxis allowDecimals={false} {...AXIS} />
          {incidentThreshold !== null && (
            <ReferenceLine
              x={incidentThreshold}
              stroke="var(--color-sev-medium)"
              strokeDasharray="3 4"
              label={{
                value: "incident bar",
                position: "insideTopLeft",
                fill: "var(--color-sev-medium)",
                fontSize: 10,
                fontFamily: "var(--font-mono)",
              }}
            />
          )}
          <Tooltip
            cursor={{ fill: "var(--color-raised)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const b = payload[0].payload as (typeof bins)[number];
              return (
                <ChartTooltip
                  title={`${b.from.toFixed(2)} – ${b.to.toFixed(2)}`}
                  rows={[{ label: "Sightings", value: b.n }]}
                />
              );
            }}
          />
          <Bar dataKey="n" fill="var(--color-signal)" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}
