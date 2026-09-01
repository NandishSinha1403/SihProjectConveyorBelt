import { useEffect, useRef, useState } from "react";
import { ExternalLink, Undo2 } from "lucide-react";
import type { Incident } from "@/lib/types";
import { api } from "@/lib/api";
import { SEVERITY_META } from "@/lib/severity";
import { cn, formatClock, formatDuration } from "@/lib/utils";
import {
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  SeverityBadge,
  SnapshotImage,
} from "@/components/ui/primitives";

export function AlertFeed({
  alerts,
  onClear,
  onRestore,
  className,
}: {
  alerts: Incident[];
  onClear: () => void;
  onRestore: (alerts: Incident[]) => void;
  className?: string;
}) {
  const critical = alerts.filter((a) => a.severity === "critical").length;

  // Clearing the rail is destructive and one click away. A confirm dialog for
  // something this cheap is friction in the wrong place -- undo is the right
  // guard: the action stays instant and stays reversible.
  const [undoable, setUndoable] = useState<Incident[] | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Only genuinely new incidents get the confirmation moment. The rail is
  // seeded from history on load, and staging thirty past defects as fresh
  // verdicts would turn the one authored moment into a slot machine.
  const seen = useRef<Set<number> | null>(null);
  const isNew = (id: number) => {
    if (seen.current === null) {
      seen.current = new Set(alerts.map((a) => a.id));
      return false;
    }
    if (seen.current.has(id)) return false;
    seen.current.add(id);
    return true;
  };

  const clear = () => {
    const snapshot = alerts;
    onClear();
    setUndoable(snapshot);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setUndoable(null), 8000);
  };

  const undo = () => {
    if (undoable) onRestore(undoable);
    setUndoable(null);
    window.clearTimeout(timer.current);
  };

  return (
    <Panel className={cn("flex flex-col", className)}>
      <PanelHeader
        title="Alerts"
        action={
          <div className="flex items-center gap-2">
            {critical > 0 && (
              <span className="animate-alarm text-[0.6875rem] uppercase tracking-[0.06em] text-sev-critical">
                {critical} critical
              </span>
            )}
            {undoable ? (
              <Button size="sm" variant="outline" onClick={undo}>
                <Undo2 size={12} strokeWidth={1.25} /> Undo
              </Button>
            ) : (
              alerts.length > 0 && (
                <Button size="sm" variant="ghost" onClick={clear}>
                  Clear
                </Button>
              )
            )}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {alerts.length === 0 && undoable ? (
          <EmptyState
            title={`Cleared ${undoable.length} alert${undoable.length === 1 ? "" : "s"}`}
            hint="They are still in the incident history. Undo restores the rail; the button disappears in a few seconds."
          />
        ) : alerts.length === 0 ? (
          <EmptyState
            title="No alerts yet"
            hint="Confirmed defects appear here the moment the model has seen them across enough consecutive frames to rule out a false positive."
          />
        ) : (
          <ul className="divide-y divide-ash/50">
            {alerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} confirming={isNew(alert.id)} />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function AlertRow({
  alert,
  confirming,
}: {
  alert: Incident;
  confirming: boolean;
}) {
  const active = alert.closed_at === null;
  const [thumbFailed, setThumbFailed] = useState(false);

  return (
    <li
      style={
        confirming
          ? ({ "--sev": SEVERITY_META[alert.severity].hex } as React.CSSProperties)
          : undefined
      }
      className={cn(
        "flex gap-3 px-4 py-3 transition-colors duration-200 ease-[var(--ease-focus)] hover:bg-raised/60",
        confirming ? "confirming" : "animate-rise",
      )}
    >

      {alert.snapshot && !thumbFailed && (
        <a
          href={api.incidentSnapshotUrl(alert.id)}
          target="_blank"
          rel="noreferrer"
          className="group relative shrink-0"
          title="Open full snapshot"
        >
          <SnapshotImage
            src={api.incidentSnapshotUrl(alert.id)}
            alt={`${alert.label} snapshot`}
            className="h-12 w-16 rounded-[5px] border border-ash/70 object-cover"
            onFailed={() => setThumbFailed(true)}
          />
          <span className="absolute inset-0 hidden items-center justify-center rounded-[5px] bg-obsidian/70 group-hover:flex">
            <ExternalLink size={12} strokeWidth={1.25} className="text-bone" />
          </span>
        </a>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[0.9375rem] text-bone">
            {alert.label}
          </span>
          <SeverityBadge severity={alert.severity} />
        </div>
        <div className="tnum mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.75rem] text-fog">
          <span>{formatClock(alert.opened_at)}</span>
          <span>{(alert.confidence * 100).toFixed(0)}% conf</span>
          <span>#{alert.id}</span>
          {active ? (
            <span className="text-ok">in view</span>
          ) : (
            <span>{formatDuration(alert.duration)}</span>
          )}
        </div>
      </div>
    </li>
  );
}
