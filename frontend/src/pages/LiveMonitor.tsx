import { useEffect, useState } from "react";
import { Link } from "@/components/Router";
import { Play, Square, Video } from "lucide-react";
import { api } from "@/lib/api";
import type { EventSocketState } from "@/hooks/useEventSocket";
import type { IncidentSummary } from "@/lib/types";
import { VideoPanel } from "@/components/VideoPanel";
import { StatsBar } from "@/components/StatsBar";
import { AlertFeed } from "@/components/AlertFeed";
import { HealthGauge } from "@/components/HealthGauge";
import { DefectCounters } from "@/components/DefectCounters";
import { Button, EmptyState, Panel } from "@/components/ui/primitives";

export function LiveMonitor({ socket }: { socket: EventSocketState }) {
  const { status, detections, alerts, clearAlerts } = socket;
  const [summary, setSummary] = useState<IncidentSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const running = Boolean(status?.running);

  // Refresh aggregates whenever an incident opens or closes, and on a slow
  // heartbeat so a long quiet stream still keeps the gauge honest.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .incidentSummary()
        .then((s) => !cancelled && setSummary(s))
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [alerts.length]);

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.stopStream();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to stop stream");
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    if (!status?.uri) return;
    setBusy(true);
    setError(null);
    try {
      await api.startStream(status.uri);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start stream");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      {/* Main column */}
      <div className="min-w-0 space-y-4">
        {running || status?.uri ? (
          <VideoPanel status={status} detections={detections} />
        ) : (
          <Panel className="grid-lines">
            <EmptyState
              icon={<Video size={30} />}
              title="No source is streaming"
              hint="Upload belt footage or connect a camera to begin monitoring. Uploaded video is played back at its true frame rate, so the model sees it exactly as it would a live feed."
              action={
                <Link to="/sources">
                  <Button variant="primary" size="sm">
                    Choose a source
                  </Button>
                </Link>
              }
            />
          </Panel>
        )}

        {(running || status?.uri) && (
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button variant="danger" size="sm" onClick={stop} disabled={busy}>
                <Square size={13} /> Stop stream
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={restart}
                disabled={busy || !status?.uri}
              >
                <Play size={13} /> Restart stream
              </Button>
            )}
            <Link to="/sources">
              <Button size="sm">Change source</Button>
            </Link>
            {error && <span className="text-xs text-sev-critical">{error}</span>}
          </div>
        )}

        <StatsBar status={status} />
      </div>

      {/* Right rail */}
      <div className="flex min-w-0 flex-col gap-4">
        <AlertFeed
          alerts={alerts}
          onClear={clearAlerts}
          className="min-h-[280px] xl:h-[calc(100vh-27rem)]"
        />
        <HealthGauge
          bySeverity={summary?.by_severity ?? {}}
          total={summary?.total ?? 0}
          allTime={summary?.all_time}
          windowHours={summary?.window_hours}
        />
        <DefectCounters counts={status?.counts ?? {}} />
      </div>
    </div>
  );
}
