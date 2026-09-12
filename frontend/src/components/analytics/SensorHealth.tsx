import { Panel, PanelHeader, Stat } from "@/components/ui/primitives";
import type { MotionSummary, PeriodEstimate } from "@/lib/analytics";
import type { ReadingSample } from "@/lib/rig/useBeltHistory";

/**
 * The hardware channel reporting on itself.
 *
 * Distinct from what the sensor says about the belt: these figures are about
 * whether the instrument is trustworthy. A drifting LDR baseline means dust on
 * the receiver, which is a maintenance item for the *sensor*, and reading it as
 * a belt condition would be exactly the wrong conclusion.
 */
export function SensorHealth({
  readings,
  motion,
  period,
  configured,
  error,
}: {
  readings: ReadingSample[];
  motion: MotionSummary;
  period: PeriodEstimate;
  configured: boolean;
  error: string | null;
}) {
  if (!configured) {
    return (
      <Panel>
        <PanelHeader title="Belt-monitor node" />
        <p className="px-4 py-5 text-[0.8125rem] leading-relaxed text-fog">
          The rig telemetry project is not configured on this deployment. Set{" "}
          <code className="font-mono text-[0.75rem] text-bone">VITE_SUPABASE_URL</code>{" "}
          and{" "}
          <code className="font-mono text-[0.75rem] text-bone">VITE_SUPABASE_ANON_KEY</code>{" "}
          to read the ESP32 node's history.
        </p>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel>
        <PanelHeader title="Belt-monitor node" />
        <p className="px-4 py-5 text-[0.8125rem] leading-relaxed text-sev-medium">
          Could not reach the rig project: {error}
        </p>
      </Panel>
    );
  }

  if (readings.length === 0) {
    return (
      <Panel>
        <PanelHeader title="Belt-monitor node" />
        <p className="px-4 py-5 text-[0.8125rem] leading-relaxed text-fog">
          The node reported nothing in this window. That is an absence of data,
          not a healthy reading — findings on this page rest on the camera alone.
        </p>
      </Panel>
    );
  }

  const vibrations = readings.map((r) => r.vibration);
  const rms = Math.sqrt(
    vibrations.reduce((a, v) => a + v * v, 0) / vibrations.length,
  );
  const peak = Math.max(...vibrations);

  // Baseline drift: the LDR's dark level at the start of the window against
  // its level at the end. A rising floor is dust or ambient light creeping in,
  // and it erodes the margin the rupture threshold depends on.
  const slice = Math.max(1, Math.floor(readings.length / 10));
  const meanLight = (rows: ReadingSample[]) =>
    rows.reduce((a, r) => a + r.lightPercent, 0) / rows.length;
  const drift = meanLight(readings.slice(-slice)) - meanLight(readings.slice(0, slice));

  // The firmware posts about once a second; the share of expected samples that
  // actually arrived is the node's availability over the window.
  const spanSeconds =
    (readings[readings.length - 1].t - readings[0].t) / 1000;
  const uptime =
    spanSeconds > 0
      ? Math.min(100, Math.round((100 * readings.length) / spanSeconds))
      : 100;

  const warnings = readings.filter((r) => r.status === "WARNING").length;

  return (
    <Panel>
      <PanelHeader title="Belt-monitor node" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 px-4 py-5 sm:grid-cols-3">
        <Stat
          label="Vibration RMS"
          value={rms.toFixed(3)}
          hint="Root-mean-square of the accelerometer trace over the window"
        />
        <Stat
          label="Peak"
          value={peak.toFixed(3)}
          hint="Largest single vibration reading"
        />
        <Stat
          label="Duty cycle"
          value={motion.unknown ? "—" : `${Math.round(motion.dutyCycle * 100)}%`}
          hint="Share of observed time the belt was actually moving"
        />
        <Stat
          label="Node uptime"
          value={`${uptime}%`}
          unit=""
          tone={uptime >= 90 ? "good" : "warn"}
          hint="Readings received against the ~1 Hz the firmware posts at"
        />
        <Stat
          label="LDR drift"
          value={`${drift >= 0 ? "+" : ""}${drift.toFixed(1)}`}
          unit="pp"
          tone={Math.abs(drift) > 5 ? "warn" : "default"}
          hint="Change in mean light level, start of window to end. A rising floor is usually dust on the receiver."
        />
        <Stat
          label="Revolution"
          value={period.seconds === null ? "—" : `${period.seconds}`}
          unit={period.seconds === null ? "" : "s"}
          hint={
            period.seconds === null
              ? "No clear periodicity in the vibration trace"
              : `Estimated from vibration autocorrelation (strength ${period.strength.toFixed(2)})`
          }
        />
      </div>

      <p className="border-t border-ash/70 px-4 py-2.5 text-[0.6875rem] leading-relaxed text-fog">
        {warnings > 0
          ? `The node self-reported WARNING on ${warnings} of ${readings.length} readings. That is its own onboard LDR threshold, not a confirmed camera detection.`
          : `The node self-reported NORMAL across all ${readings.length} readings in this window.`}
        {period.seconds !== null &&
          " Revolution period is an estimate from vibration periodicity, not a measured constant."}
      </p>
    </Panel>
  );
}
