import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS, ChartPanel, ChartTooltip, GRID } from "@/components/ui/Chart";
import { EmptyState } from "@/components/ui/primitives";
import { CORRELATION_TOLERANCE_MS, type FusionPoint } from "@/lib/analytics";
import { formatClock } from "@/lib/utils";

/**
 * Both channels on one time axis.
 *
 * This is the chart the whole page is arranged around. The camera pipeline and
 * the ESP32 node watch the same belt, so a reader should be able to run a
 * finger down any vertical line and see what each instrument said at that
 * moment: bars for confirmed defects, a line for vibration, and a shaded band
 * wherever the optical sensor was in WARNING.
 *
 * What it deliberately does not do is merge them into a single verdict. The
 * node's WARNING is its own onboard LDR threshold; a confirmed incident is the
 * pipeline's severity model. Showing them as two marks that happen to line up
 * is the honest presentation -- and when they *don't* line up, that is a real
 * finding rather than a rendering bug.
 */
export function FusionTimeline({
  data,
  hasSensor,
  loading,
}: {
  data: FusionPoint[];
  hasSensor: boolean;
  loading: boolean;
}) {
  // Clamp to the extent of buckets that actually carry something. Spanning the
  // *requested* window is what turned one 40-second run inside an 8-hour
  // look-back into two bars pinned to opposite edges of an empty axis.
  const carrying = data.filter(
    (d) => d.incidents > 0 || d.vibration !== null || d.warning,
  );
  const domain: [number, number] | undefined =
    carrying.length > 0
      ? [carrying[0].t, carrying[carrying.length - 1].t]
      : undefined;

  // A span of one bucket has no width to draw across; pad it so the marks are
  // not stacked on a single pixel column.
  if (domain && domain[0] === domain[1]) {
    domain[0] -= 30_000;
    domain[1] += 30_000;
  }

  const note = hasSensor
    ? `Vision incidents and sensor readings are stamped by different clocks — the API host's and Supabase's — so alignment is accurate to roughly ±${CORRELATION_TOLERANCE_MS / 1000}s, not to the second.`
    : "The belt-monitor node reported nothing in this window, so only the vision channel is plotted. That is missing data, not a quiet sensor.";

  if (!loading && data.length === 0) {
    return (
      <ChartPanel title="Vision and sensor, one belt" height={260} note={note}>
        <EmptyState
          title="Nothing recorded in this window."
          hint="Run a session, or widen the window, and both channels will draw here on a shared time axis."
        />
      </ChartPanel>
    );
  }

  return (
    <ChartPanel
      title="Vision and sensor, one belt"
      subtitle="Confirmed defects, belt vibration, and optical-sensor warnings on a shared axis"
      height={300}
      note={note}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
          <CartesianGrid {...GRID} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={domain ?? ["dataMin", "dataMax"]}
            tickFormatter={(t: number) => formatClock(t / 1000)}
            tickCount={6}
            minTickGap={40}
            {...AXIS}
          />
          {/* Left axis carries counts, right carries vibration: they share a
              time axis but nothing else, and a single scale would flatten one
              of them into the baseline. */}
          <YAxis yAxisId="count" allowDecimals={false} {...AXIS} />
          {hasSensor && <YAxis yAxisId="vib" orientation="right" {...AXIS} />}

          {/* The warning band sits behind everything, drawn as a full-height
              area so it reads as a period rather than as a value. */}
          <Area
            yAxisId="count"
            dataKey={(d: FusionPoint) => (d.warning ? Number.MAX_SAFE_INTEGER : 0)}
            fill="var(--color-sev-medium)"
            fillOpacity={0.12}
            stroke="none"
            isAnimationActive={false}
            legendType="none"
            baseValue={0}
          />

          <Bar
            yAxisId="count"
            dataKey="incidents"
            fill="var(--color-sev-high)"
            fillOpacity={0.75}
            isAnimationActive={false}
            maxBarSize={14}
          />
          <Bar
            yAxisId="count"
            dataKey="critical"
            fill="var(--color-sev-critical)"
            isAnimationActive={false}
            maxBarSize={14}
          />
          {hasSensor && (
            <Line
              yAxisId="vib"
              type="monotone"
              dataKey="vibration"
              stroke="var(--color-signal)"
              strokeWidth={1.25}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          )}

          <Tooltip
            cursor={{ stroke: "var(--color-veil)", strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as FusionPoint;
              return (
                <ChartTooltip
                  title={formatClock(Number(label) / 1000)}
                  rows={[
                    {
                      label: "Confirmed defects",
                      value: p.incidents,
                      color: "var(--color-sev-high)",
                    },
                    ...(p.critical > 0
                      ? [{
                          label: "of which critical",
                          value: p.critical,
                          color: "var(--color-sev-critical)",
                        }]
                      : []),
                    ...(p.vibration !== null
                      ? [{
                          label: "Vibration",
                          value: p.vibration.toFixed(3),
                          color: "var(--color-signal)",
                        }]
                      : []),
                    ...(p.lightPercent !== null
                      ? [{ label: "Light", value: `${p.lightPercent}%` }]
                      : []),
                    ...(p.warning
                      ? [{
                          label: "Sensor",
                          value: "WARNING",
                          color: "var(--color-sev-medium)",
                        }]
                      : []),
                  ]}
                />
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}
