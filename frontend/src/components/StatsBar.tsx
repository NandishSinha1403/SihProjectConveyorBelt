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
/**
 * Turn the detector's own description into something an operator can read.
 *
 * "YOLO belt_v1.pt on mps" is a developer string; the person watching a belt
 * needs to know whether the thing making decisions is trained or synthetic.
 */
function describeDetector(detector: string | null | undefined): string {
  if (!detector) return "No detector loaded";
  if (detector.toLowerCase().includes("synthetic") || detector.startsWith("Mock")) {
    return "Demo detector — synthetic defects, not a trained model";
  }
  if (detector.includes("TRACKING UNAVAILABLE")) {
    return "Trained model, but defect tracking is unavailable — no alerts will be raised";
  }
  const device = /on (\w+)$/.exec(detector)?.[1];
  const accelerator =
    device === "mps" ? "Apple GPU" : device === "cuda" ? "NVIDIA GPU" : "CPU";
  return `Trained model, running on ${accelerator}`;
}

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

      {/* The skip count is the product's central claim, so it is stated on the
          page rather than hidden in a tooltip that never fires on touch and
          cannot be reached from a keyboard. */}
      <p className="mt-4 max-w-[68ch] border-t border-ash/70 pt-3 text-[0.8125rem] leading-relaxed text-fog">
        {running ? (
          <>
            <span className="text-bone">
              Skipped frames are the proof this is live.
            </span>{" "}
            They arrived while the model was still working on an earlier one, so
            they were dropped rather than queued — exactly what a camera does.
            {skipRatio > 0.05 && (
              <>
                {" "}
                Right now{" "}
                <span className="tnum text-sev-medium">
                  {(skipRatio * 100).toFixed(0)}%
                </span>{" "}
                are being dropped, which means detection is running slower than
                the belt is being filmed.
              </>
            )}
          </>
        ) : (
          <>
            Start a source to see live throughput. Skipped frames — dropped
            rather than queued while the model was busy — are what separates
            monitoring a feed from processing a file.
          </>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[0.75rem] text-fog">
        <span className="truncate">{describeDetector(status?.detector)}</span>
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
        {status?.error && (
          <span className="text-sev-critical">{status.error}</span>
        )}
      </div>
    </Panel>
  );
}
