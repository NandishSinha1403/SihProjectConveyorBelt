import { useCallback, useEffect, useState } from "react";
import { Download, ImageOff, X } from "lucide-react";
import { api } from "@/lib/api";
import { SEVERITY_META } from "@/lib/severity";
import type { Incident, Severity } from "@/lib/types";
import { cn, formatDateTime, formatDuration } from "@/lib/utils";
import {
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  SeverityBadge,
  Skeleton,
} from "@/components/ui/primitives";

const PAGE_SIZE = 50;

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const CLASSES = [
  "joint_damage",
  "tear",
  "hole",
  "crack",
  "scratch",
  "belt_joint",
];

export function Incidents({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<Incident[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [severity, setSeverity] = useState<string>("");
  const [cls, setCls] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Incident | null>(null);

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

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title={`${total} incident${total === 1 ? "" : "s"}`}
          action={
            <a href={api.exportCsvUrl(severity || undefined, cls || undefined)}>
              <Button size="sm" variant="outline">
                <Download size={12} strokeWidth={1.25} />
                <span className="hidden sm:inline">Export CSV</span>
                <span className="sm:hidden">CSV</span>
              </Button>
            </a>
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
                      onClick={() => setSelected(incident)}
                      className="cursor-pointer transition-colors duration-200 ease-[var(--ease-focus)] hover:bg-raised/60"
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
                        {incident.snapshot ? (
                          <img
                            src={api.incidentSnapshotUrl(incident.id)}
                            alt=""
                            loading="lazy"
                            className="h-9 w-14 rounded-[5px] border border-ash/70 object-cover"
                          />
                        ) : (
                          <ImageOff size={14} strokeWidth={1.25} className="text-fog" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="divide-y divide-ash/50 md:hidden">
              {items.map((incident) => (
                <li
                  key={incident.id}
                  onClick={() => setSelected(incident)}
                  className="flex cursor-pointer gap-3 px-4 py-3.5 transition-colors duration-200 ease-[var(--ease-focus)] active:bg-raised/60"
                >
                  {incident.snapshot && (
                    <img
                      src={api.incidentSnapshotUrl(incident.id)}
                      alt=""
                      loading="lazy"
                      className="h-14 w-20 shrink-0 rounded-[5px] border border-ash/70 object-cover"
                    />
                  )}
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-obsidian/80 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className={cn(
          "animate-rise max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-t-[15px] border border-ash/70 bg-panel sm:rounded-[15px]",
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Incident ${incident.id}`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ash/70 bg-panel px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <h3 className="truncate text-[1.375rem] leading-none tracking-[-0.01em] text-bone">
              {incident.label}
            </h3>
            <SeverityBadge severity={incident.severity} />
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X size={16} strokeWidth={1.25} />
          </Button>
        </div>

        {incident.snapshot && (
          <img
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
