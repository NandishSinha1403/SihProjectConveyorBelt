import { AlertTriangle, BellOff, ExternalLink } from "lucide-react";
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
        title="Alert Feed"
        icon={<AlertTriangle size={13} />}
        action={
          <div className="flex items-center gap-2">
            {critical > 0 && (
              <span className="animate-alarm rounded bg-sev-critical/15 px-1.5 py-0.5 text-[10px] font-bold text-sev-critical">
                {critical} CRITICAL
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
            icon={<BellOff size={26} />}
            title="No alerts yet"
            hint="Confirmed defects appear here the moment the model has seen them across enough consecutive frames to rule out a false positive."
          />
        ) : (
          <ul className="divide-y divide-line-soft">
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
  const meta = SEVERITY_META[alert.severity];
  const active = alert.closed_at === null;

  return (
    <li className="animate-slide-in flex gap-3 px-3 py-2.5 transition-colors hover:bg-raised/50">
      <div className={cn("w-0.5 shrink-0 rounded-full", meta.dot)} />

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
            className="h-12 w-16 rounded border border-line object-cover"
          />
          <span className="absolute inset-0 hidden items-center justify-center rounded bg-void/60 group-hover:flex">
            <ExternalLink size={12} className="text-ink" />
          </span>
        </a>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-ink">
            {alert.label}
          </span>
          <SeverityBadge severity={alert.severity} />
        </div>
        <div className="tnum mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink-faint">
          <span>{formatClock(alert.opened_at)}</span>
          <span>{(alert.confidence * 100).toFixed(0)}% conf</span>
          <span>#{alert.id}</span>
          {active ? (
            <span className="font-medium text-ok">in view</span>
          ) : (
            <span>{formatDuration(alert.duration)}</span>
          )}
        </div>
      </div>
    </li>
  );
}
