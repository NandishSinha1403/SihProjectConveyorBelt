import { useEffect, useMemo, useState } from "react";
import { Link } from "@/components/Router";
import { Bell, BellOff, Keyboard, Play, Square } from "lucide-react";
import { api } from "@/lib/api";
import type { EventSocketState } from "@/hooks/useEventSocket";
import type { IncidentSummary } from "@/lib/types";
import { VideoPanel } from "@/components/VideoPanel";
import { StatsBar } from "@/components/StatsBar";
import { AlertFeed } from "@/components/AlertFeed";
import { BeltHealth } from "@/components/BeltHealth";
import { Button, EmptyState, Panel } from "@/components/ui/primitives";
import { useHotkeys, type Hotkey } from "@/hooks/useHotkeys";
import type { useAlarm } from "@/hooks/useAlarm";

export function LiveMonitor({
  socket,
  alarm,
}: {
  socket: EventSocketState;
  alarm: ReturnType<typeof useAlarm>;
}) {
  const { status, detections, alerts, clearAlerts, restoreAlerts } = socket;
  const [summary, setSummary] = useState<IncidentSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [overlay, setOverlay] = useState<"burned" | "canvas" | "off">("burned");
  const [showKeys, setShowKeys] = useState(false);

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

  const hotkeys = useMemo<Hotkey[]>(
    () => [
      {
        key: " ",
        label: "Space",
        description: "Freeze or resume the display",
        run: () => setPaused((p) => !p),
      },
      {
        key: "s",
        label: "S",
        description: "Stop or restart the stream",
        run: () => (running ? stop() : restart()),
      },
      {
        key: "o",
        label: "O",
        description: "Cycle the detection overlay",
        run: () =>
          setOverlay((o) =>
            o === "burned" ? "canvas" : o === "canvas" ? "off" : "burned",
          ),
      },
      {
        key: "a",
        label: "A",
        description: "Arm or silence the audible alarm",
        run: () => void alarm.toggle(),
      },
      {
        key: "?",
        label: "?",
        description: "Show these shortcuts",
        run: () => setShowKeys((v) => !v),
      },
    ],
    // stop/restart are stable enough for a shortcut table that only reads them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [running, alarm.toggle],
  );

  useHotkeys(hotkeys);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_372px] xl:gap-7">
      {/* Main column. The feed and its controls are one group and sit close
          together; the telemetry beneath is a separate thought and gets air. */}
      <div className="min-w-0">
        {running || status?.uri ? (
          <VideoPanel
            status={status}
            detections={detections}
            paused={paused}
            onPausedChange={setPaused}
            overlay={overlay}
            onOverlayChange={setOverlay}
          />
        ) : (
          <Panel>
            <EmptyState
              title="No source is streaming"
              hint="Upload belt footage or connect a camera to begin monitoring. Uploaded video is played back at its true frame rate, so the model sees it exactly as it would a live feed."
              action={
                <Link to="/sources">
                  <Button variant="outline" size="sm">
                    Choose a source
                  </Button>
                </Link>
              }
            />
          </Panel>
        )}

        {(running || status?.uri) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2">
            {running ? (
              <Button variant="danger" size="sm" onClick={stop} disabled={busy}>
                <Square size={13} /> Stop stream
              </Button>
            ) : (
              <Button
                variant="outline"
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

            <span className="mx-1 hidden h-4 w-px bg-ash sm:inline-block" aria-hidden />

            <Button
              size="sm"
              variant="ghost"
              onClick={() => void alarm.toggle()}
              aria-pressed={alarm.enabled}
              aria-label={
                alarm.enabled
                  ? "Audible alarm is on. Silence it."
                  : "Audible alarm is off. Sound an alarm on critical defects."
              }
            >
              {alarm.enabled ? (
                <Bell size={13} strokeWidth={1.25} className="text-bone" />
              ) : (
                <BellOff size={13} strokeWidth={1.25} />
              )}
              <span className={alarm.enabled ? "text-bone" : undefined}>
                {alarm.enabled ? "Alarm on" : "Alarm off"}
              </span>
            </Button>

            {/* A discoverability aid, not an action. It should be findable and
                otherwise invisible. */}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setShowKeys((v) => !v)}
              aria-expanded={showKeys}
              aria-label="Show keyboard shortcuts"
              title="Keyboard shortcuts — ?"
            >
              <Keyboard size={14} strokeWidth={1.25} />
            </Button>

            {error && (
              <span className="text-[0.8125rem] text-sev-critical">{error}</span>
            )}
          </div>
        )}

        {showKeys && (
          <Panel className="mt-3 px-4 py-3.5">
            <dl className="flex flex-wrap gap-x-7 gap-y-2.5">
              {hotkeys.map((k) => (
                <div key={k.label} className="flex items-center gap-2.5">
                  <dt className="rounded-[5px] border border-ash px-1.5 py-0.5 font-mono text-[0.6875rem] text-bone">
                    {k.label}
                  </dt>
                  <dd className="text-[0.8125rem] text-fog">{k.description}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        )}

        {alarm.enabled && !alarm.armed && (
          <p className="mt-3 max-w-[62ch] text-[0.8125rem] leading-relaxed text-sev-medium">
            The browser blocked audio, so the alarm cannot sound. Click anywhere
            on the page, then switch the alarm off and on again.
          </p>
        )}

        {/* Generous break: throughput is a different question from the feed. */}
        <div className="mt-8">
          <StatsBar status={status} />
        </div>
      </div>

      {/* Right rail */}
      <div className="flex min-w-0 flex-col gap-4">
        <AlertFeed
          alerts={alerts}
          onClear={clearAlerts}
          onRestore={restoreAlerts}
          className="min-h-[340px] xl:h-[calc(100dvh-30rem)]"
        />
        <BeltHealth summary={summary} />
      </div>
    </div>
  );
}
