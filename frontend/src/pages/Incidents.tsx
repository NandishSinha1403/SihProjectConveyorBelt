import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ImageOff, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { SEVERITY_META } from "@/lib/severity";
import type { Incident, Severity, StreamStatus } from "@/lib/types";
import { cn, formatDateTime, formatDuration } from "@/lib/utils";
import {
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  SeverityBadge,
  Skeleton,
  SnapshotImage,
} from "@/components/ui/primitives";

const PAGE_SIZE = 50;

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
// belt_joint is absent deliberately: a healthy joint is a landmark, not an
// event, so it never produces a row here. See NON_INCIDENT_CLASSES in
// backend/app/pipeline/events.py.
const CLASSES = ["joint_damage", "tear", "hole", "crack", "scratch"];

export function Incidents({
  refreshKey,
  status,
}: {
  refreshKey: number;
  status: StreamStatus | null;
}) {
  const [items, setItems] = useState<Incident[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [severity, setSeverity] = useState<string>("");
  const [cls, setCls] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Both clears are permanent, so each needs a second deliberate click before
  // it fires -- the same one-tap-arms, second-tap-fires pattern Sources uses
  // for deleting footage, rather than a modal that interrupts the task.
  const [confirmClear, setConfirmClear] = useState<"session" | "all" | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listIncidents({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        severity: severity || undefined,
        cls: cls || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, severity, cls]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // A filter change invalidates the current page offset.
  useEffect(() => setPage(0), [severity, cls]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const clear = async (target: "session" | "all") => {
    if (confirmClear !== target) {
      setConfirmClear(target);
      window.setTimeout(
        () => setConfirmClear((c) => (c === target ? null : c)),
        4000,
      );
      return;
    }
    setConfirmClear(null);
    setClearing(true);
    setError(null);
    try {
      if (target === "session") {
        await api.clearCurrentSessionIncidents();
      } else {
        await api.clearAllIncidents();
      }
      setPage(0);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-[5px] border border-sev-critical/50 px-3.5 py-2.5 text-[0.8125rem] text-sev-critical">
          {error}
        </div>
      )}

      <Panel>
        <PanelHeader
          title={`${total} incident${total === 1 ? "" : "s"}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!status?.running || clearing}
                title={
                  status?.running
                    ? undefined
                    : "No session is running"
                }
                onClick={() => void clear("session")}
              >
                <Trash2 size={12} strokeWidth={1.25} />
                <span className="hidden sm:inline">
                  {confirmClear === "session"
                    ? "Confirm: clear this session"
                    : "Clear current session"}
                </span>
                <span className="sm:hidden">
                  {confirmClear === "session" ? "Confirm" : "Clear session"}
                </span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={clearing}
                onClick={() => void clear("all")}
              >
                <Trash2 size={12} strokeWidth={1.25} />
                <span className="hidden sm:inline">
                  {confirmClear === "all"
                    ? "Confirm: clear all history"
                    : "Clear all history"}
                </span>
                <span className="sm:hidden">
                  {confirmClear === "all" ? "Confirm" : "Clear all"}
                </span>
              </Button>
              <a href={api.exportCsvUrl(severity || undefined, cls || undefined)}>
                <Button size="sm" variant="outline">
                  <Download size={12} strokeWidth={1.25} />
                  <span className="hidden sm:inline">Export CSV</span>
                  <span className="sm:hidden">CSV</span>
                </Button>
              </a>
            </div>
          }
        />

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 border-b border-ash/70 px-4 py-3">
          <Select
            value={severity}
            onChange={setSeverity}
            placeholder="All severities"
            options={SEVERITIES.map((s) => ({
              value: s,
              label: SEVERITY_META[s].label,
            }))}
          />
          <Select
            value={cls}
            onChange={setCls}
            placeholder="All defect types"
            options={CLASSES.map((c) => ({
              value: c,
              label: c.replace("_", " "),
            }))}
          />
          {(severity || cls) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSeverity("");
                setCls("");
              }}
            >
              Reset
            </Button>
          )}
        </div>

        {loading ? (
          // Shaped like the rows it replaces, so the layout does not jump when
          // the data lands.
          <ul className="divide-y divide-ash/50">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="h-9 w-14 shrink-0" />
                <Skeleton className="h-3 w-32" />
                <Skeleton className="ml-auto h-4 w-16 rounded-full" />
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
          <EmptyState
            title="No incidents recorded"
            hint="Confirmed defects are written here with a snapshot as soon as the model has tracked them across enough consecutive frames."
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ash/70 text-left text-[0.6875rem] uppercase tracking-[0.08em] text-fog">
                    <th className="px-4 py-2 font-medium">ID</th>
                    <th className="px-4 py-2 font-medium">Opened</th>
                    <th className="px-4 py-2 font-medium">Defect</th>
                    <th className="px-4 py-2 font-medium">Severity</th>
                    <th className="px-4 py-2 font-medium">Conf.</th>
                    <th className="px-4 py-2 font-medium">Duration</th>
                    <th className="px-4 py-2 font-medium">Snapshot</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ash/50">
                  {items.map((incident) => (
                    <tr
                      key={incident.id}
                      // A row that opens evidence is a control, so it has to
                      // behave like one: focusable, named, and operable with
                      // Enter or Space. Without this the audit trail simply
                      // does not exist for a keyboard or screen-reader user.
                      role="button"
                      tabIndex={0}
                      aria-label={`Incident ${incident.id}, ${incident.label}, ${incident.severity} severity. Open details.`}
                      onClick={() => setSelected(incident)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected(incident);
                        }
                      }}
                      className="cursor-pointer transition-colors duration-200 ease-[var(--ease-focus)] hover:bg-raised/60 focus-visible:bg-raised/60 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-bone"
                    >
                      <td className="tnum px-4 py-3 text-fog">#{incident.id}</td>
                      <td className="tnum whitespace-nowrap px-4 py-3 text-fog">
                        {formatDateTime(incident.opened_at)}
                      </td>
                      <td className="px-4 py-3 text-bone">{incident.label}</td>
                      <td className="px-4 py-3">
                        <SeverityBadge severity={incident.severity} />
                      </td>
                      <td className="tnum px-4 py-3 text-fog">
                        {(incident.confidence * 100).toFixed(0)}%
                      </td>
                      <td className="tnum px-4 py-3 text-fog">
                        {incident.closed_at ? (
                          formatDuration(incident.duration)
                        ) : (
                          <span className="text-ok">active</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <IncidentThumb
                          incident={incident}
                          className="h-9 w-14 rounded-[5px] border border-ash/70 object-cover"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="divide-y divide-ash/50 md:hidden">
              {items.map((incident) => (
                <li key={incident.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(incident)}
                    aria-label={`Incident ${incident.id}, ${incident.label}, ${incident.severity} severity. Open details.`}
                    className="flex w-full gap-3 px-4 py-3.5 text-left transition-colors duration-200 ease-[var(--ease-focus)] active:bg-raised/60"
                  >
                  <IncidentThumb
                    incident={incident}
                    className="h-14 w-20 shrink-0 rounded-[5px] border border-ash/70 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-bone">{incident.label}</span>
                      <SeverityBadge severity={incident.severity} />
                    </div>
                    <p className="tnum mt-1.5 text-[0.75rem] text-fog">
                      #{incident.id} · {formatDateTime(incident.opened_at)} ·{" "}
                      {(incident.confidence * 100).toFixed(0)}%
                    </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            {pages > 1 && (
              <div className="flex items-center justify-between border-t border-ash/70 px-4 py-3 text-[0.8125rem] text-fog">
                <span className="tnum">
                  Page {page + 1} of {pages}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                    disabled={page >= pages - 1}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>

      {selected && (
        <IncidentDrawer
          incident={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/** A list-row thumbnail that falls back to the placeholder icon once the
 * snapshot fails to load after retrying -- see SnapshotImage. */
function IncidentThumb({
  incident,
  className,
}: {
  incident: Incident;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!incident.snapshot || failed) {
    return <ImageOff size={14} strokeWidth={1.25} className="text-fog" />;
  }
  return (
    <SnapshotImage
      src={api.incidentSnapshotUrl(incident.id)}
      alt=""
      className={className}
      onFailed={() => setFailed(true)}
    />
  );
}

function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-[5px] border border-ash bg-raised px-2.5 text-[0.75rem] capitalize text-bone transition-colors duration-200 ease-[var(--ease-focus)] hover:border-fog focus:border-bone focus:outline-none"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function IncidentDrawer({
  incident,
  onClose,
}: {
  incident: Incident;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Remember where focus came from so dismissing returns the user to the row
    // they opened, rather than dropping them at the document root.
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      // Trap: a dialog the user can Tab out of is a dialog in name only.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-obsidian/80 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className={cn(
          "animate-rise max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-t-[15px] border border-ash/70 bg-panel sm:rounded-[15px]",
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`incident-${incident.id}-title`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ash/70 bg-panel px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <h3
              id={`incident-${incident.id}-title`}
              className="truncate text-[1.375rem] leading-none tracking-[-0.01em] text-bone"
            >
              {incident.label}
            </h3>
            <SeverityBadge severity={incident.severity} />
          </div>
          <Button
            ref={closeRef}
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label="Close incident details"
          >
            <X size={16} strokeWidth={1.25} />
          </Button>
        </div>

        {incident.snapshot && (
          <SnapshotImage
            src={api.incidentSnapshotUrl(incident.id)}
            alt={`${incident.label} at the moment of confirmation`}
            className="w-full bg-pitch object-contain"
          />
        )}

        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 p-4 text-[0.9375rem] sm:grid-cols-3">
          <Field label="Incident ID" value={`#${incident.id}`} />
          <Field label="Track ID" value={String(incident.track_id)} />
          <Field label="Confidence" value={`${(incident.confidence * 100).toFixed(1)}%`} />
          <Field label="Opened" value={formatDateTime(incident.opened_at)} />
          <Field
            label="Closed"
            value={incident.closed_at ? formatDateTime(incident.closed_at) : "Active"}
          />
          <Field
            label="Duration"
            value={formatDuration(
              // Active incidents have no stored duration yet, so measure from
              // when they opened rather than rendering a placeholder dash.
              incident.closed_at
                ? incident.duration
                : Date.now() / 1000 - incident.opened_at,
            )}
          />
          <Field
            label="Frames"
            value={`${incident.first_frame} – ${incident.last_frame}`}
          />
          <Field label="Defect class" value={incident.cls} />
        </dl>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.6875rem] uppercase tracking-[0.08em] text-fog">
        {label}
      </dt>
      <dd className="tnum mt-1 text-bone">{value}</dd>
    </div>
  );
}
