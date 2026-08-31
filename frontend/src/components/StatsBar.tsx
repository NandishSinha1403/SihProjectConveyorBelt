import type { StreamStatus } from "@/lib/types";
import { formatDuration } from "@/lib/utils";
import { Panel, Stat } from "@/components/ui/primitives";

/**
 * Pipeline telemetry.
 *
 * "Frames skipped" is the one figure here that is not routine plumbing. It
 * counts frames that arrived while the detector was busy and were therefore
 * never analysed. A file being batch-processed would sit at zero forever; a
 * genuine real-time feed under load shows it climbing. It gets equal billing
 * with frame rate for that reason.
 */
export function StatsBar({ status }: { status: StreamStatus | null }) {
  const running = Boolean(status?.running);
  const capture = status?.capture_fps ?? 0;
  const inference = status?.inference_fps ?? 0;
  const skipped = status?.frames_skipped ?? 0;
  const read = status?.frames_read ?? 0;

  const skipRatio = read > 0 ? skipped / read : 0;
  const keepingUp = capture > 0 && inference >= capture * 0.9;

  return (
    <Panel className="px-4 py-4 sm:px-5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Capture"
          value={running ? capture.toFixed(1) : "—"}
          unit="fps"
          hint="Rate at which frames arrive from the source"
        />
        <Stat
          label="Inference"
          value={running ? inference.toFixed(1) : "—"}
          unit="fps"
          tone={running ? (keepingUp ? "good" : "warn") : "default"}
          hint="Rate at which the model analyses frames"
        />
        <Stat
          label="Latency"
          value={running ? (status?.inference_ms ?? 0).toFixed(0) : "—"}
          unit="ms"
          hint="Model time per analysed frame"
        />
        <Stat
          label="Skipped"
          value={running || skipped ? skipped.toLocaleString() : "—"}
          tone={skipRatio > 0.5 ? "warn" : "default"}
          hint="Frames that passed while the model was busy. Proof the feed is processed live, not buffered."
        />
        <Stat
          label="Processed"
          value={(status?.frames_processed ?? 0).toLocaleString()}
          hint="Total frames analysed this session"
        />
        <Stat
          label="Uptime"
          value={running ? formatDuration(status?.uptime ?? 0) : "—"}
          hint="Time since this stream started"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-ash/70 pt-3 text-[0.75rem] text-fog">
        <span className="truncate">{status?.detector ?? "No detector"}</span>
        {status?.width ? (
          <span className="tnum">
            {status.width}&times;{status.height}
            {status.source_fps ? ` at ${status.source_fps} fps` : ""}
          </span>
        ) : null}
        {running && (
          <span className="tnum">
            {status?.open_incidents ?? 0} defect
            {(status?.open_incidents ?? 0) === 1 ? "" : "s"} in view
          </span>
        )}
        {skipRatio > 0.05 && (
          <span
            className="tnum text-sev-medium"
            title="The model is slower than the source, so frames are dropped rather than queued — exactly as they would be with a live camera."
          >
            {(skipRatio * 100).toFixed(0)}% of frames dropped
          </span>
        )}
        {status?.error && (
          <span className="text-sev-critical">{status.error}</span>
        )}
      </div>
    </Panel>
  );
}
