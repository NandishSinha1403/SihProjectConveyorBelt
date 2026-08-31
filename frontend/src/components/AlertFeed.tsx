import { ExternalLink } from "lucide-react";
import type { Incident } from "@/lib/types";
import { api } from "@/lib/api";
import { cn, formatClock, formatDuration } from "@/lib/utils";
import {
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  SeverityBadge,
} from "@/components/ui/primitives";

export function AlertFeed({
  alerts,
  onClear,
  className,
}: {
  alerts: Incident[];
  onClear: () => void;
  className?: string;
}) {
  const critical = alerts.filter((a) => a.severity === "critical").length;

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
            {alerts.length > 0 && (
              <Button size="sm" variant="ghost" onClick={onClear}>
                Clear
              </Button>
            )}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {alerts.length === 0 ? (
          <EmptyState
            title="No alerts yet"
            hint="Confirmed defects appear here the moment the model has seen them across enough consecutive frames to rule out a false positive."
          />
        ) : (
          <ul className="divide-y divide-ash/50">
            {alerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function AlertRow({ alert }: { alert: Incident }) {
  const active = alert.closed_at === null;

  return (
    <li className="animate-rise flex gap-3 px-4 py-3 transition-colors duration-200 ease-[var(--ease-focus)] hover:bg-raised/60">

      {alert.snapshot && (
        <a
          href={api.incidentSnapshotUrl(alert.id)}
          target="_blank"
          rel="noreferrer"
          className="group relative shrink-0"
          title="Open full snapshot"
        >
          <img
            src={api.incidentSnapshotUrl(alert.id)}
            alt={`${alert.label} snapshot`}
            loading="lazy"
            className="h-12 w-16 rounded-[5px] border border-ash/70 object-cover"
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
