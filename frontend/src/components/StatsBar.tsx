import { Activity, Cpu, Gauge, SkipForward, Timer } from "lucide-react";
import type { StreamStatus } from "@/lib/types";
import { formatDuration } from "@/lib/utils";
import { Panel, Stat } from "@/components/ui/primitives";

/**
 * The pipeline telemetry strip.
 *
 * "Frames skipped" is the one number here that is not routine plumbing. It is
 * the count of frames that arrived while the detector was busy and were
 * therefore never analysed. A file being batch-processed would show zero
 * forever; a genuine real-time feed under load shows it climbing. It is
 * deliberately given equal billing with FPS.
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
    <Panel className="px-4 py-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
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
          label="Frames skipped"
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

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line-soft pt-2.5 text-[11px] text-ink-faint">
        <span className="inline-flex items-center gap-1.5">
          <Cpu size={11} />
          {status?.detector ?? "no detector"}
        </span>
        {status?.width ? (
          <span className="inline-flex items-center gap-1.5">
            <Gauge size={11} />
            {status.width}×{status.height}
            {status.source_fps ? ` @ ${status.source_fps} fps source` : ""}
          </span>
        ) : null}
        {running && (
          <span className="inline-flex items-center gap-1.5">
            <Activity size={11} />
            {status?.open_incidents ?? 0} defect
            {(status?.open_incidents ?? 0) === 1 ? "" : "s"} in view
          </span>
        )}
        {skipRatio > 0.05 && (
          <span
            className="inline-flex items-center gap-1.5 text-sev-medium"
            title="The model is slower than the source, so frames are being dropped rather than queued — exactly as they would be with a live camera."
          >
            <SkipForward size={11} />
            {(skipRatio * 100).toFixed(0)}% of frames dropped
          </span>
        )}
        {status?.error && (
          <span className="inline-flex items-center gap-1.5 text-sev-critical">
            <Timer size={11} />
            {status.error}
          </span>
        )}
      </div>
    </Panel>
  );
}
