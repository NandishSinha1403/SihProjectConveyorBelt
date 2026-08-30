import { useCallback, useEffect, useState } from "react";
import { Download, FileWarning, ImageOff, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Incident, Severity } from "@/lib/types";
import { SEVERITY_META } from "@/lib/severity";
import { cn, formatDateTime, formatDuration } from "@/lib/utils";
import {
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  SeverityBadge,
  Spinner,
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
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title={`Incident History — ${total} record${total === 1 ? "" : "s"}`}
          icon={<FileWarning size={13} />}
          action={
            <a href={api.exportCsvUrl(severity || undefined, cls || undefined)}>
              <Button size="sm">
                <Download size={12} /> Export CSV
              </Button>
            </a>
          }
        />

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
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
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<FileWarning size={26} />}
            title="No incidents recorded"
            hint="Confirmed defects are written here with a snapshot as soon as the model has tracked them across enough consecutive frames."
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] uppercase tracking-[0.12em] text-ink-faint">
                    <th className="px-4 py-2 font-medium">ID</th>
                    <th className="px-4 py-2 font-medium">Opened</th>
                    <th className="px-4 py-2 font-medium">Defect</th>
                    <th className="px-4 py-2 font-medium">Severity</th>
                    <th className="px-4 py-2 font-medium">Conf.</th>
                    <th className="px-4 py-2 font-medium">Duration</th>
                    <th className="px-4 py-2 font-medium">Snapshot</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {items.map((incident) => (
                    <tr
                      key={incident.id}
                      onClick={() => setSelected(incident)}
                      className="cursor-pointer transition-colors hover:bg-raised/50"
                    >
                      <td className="tnum px-4 py-2 text-ink-faint">
                        #{incident.id}
                      </td>
                      <td className="tnum whitespace-nowrap px-4 py-2 text-ink-dim">
                        {formatDateTime(incident.opened_at)}
                      </td>
                      <td className="px-4 py-2 font-medium text-ink">
                        {incident.label}
                      </td>
                      <td className="px-4 py-2">
                        <SeverityBadge severity={incident.severity} />
                      </td>
                      <td className="tnum px-4 py-2 text-ink-dim">
                        {(incident.confidence * 100).toFixed(0)}%
                      </td>
                      <td className="tnum px-4 py-2 text-ink-dim">
                        {incident.closed_at ? (
                          formatDuration(incident.duration)
                        ) : (
                          <span className="text-ok">active</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {incident.snapshot ? (
                          <img
                            src={api.incidentSnapshotUrl(incident.id)}
                            alt=""
                            loading="lazy"
                            className="h-9 w-14 rounded border border-line object-cover"
                          />
                        ) : (
                          <ImageOff size={14} className="text-ink-faint" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="divide-y divide-line-soft md:hidden">
              {items.map((incident) => (
                <li
                  key={incident.id}
                  onClick={() => setSelected(incident)}
                  className="flex gap-3 px-4 py-3"
                >
                  {incident.snapshot && (
                    <img
                      src={api.incidentSnapshotUrl(incident.id)}
                      alt=""
                      loading="lazy"
                      className="h-14 w-20 shrink-0 rounded border border-line object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-ink">
                        {incident.label}
                      </span>
                      <SeverityBadge severity={incident.severity} />
                    </div>
                    <p className="tnum mt-1 text-[11px] text-ink-faint">
                      #{incident.id} · {formatDateTime(incident.opened_at)} ·{" "}
                      {(incident.confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            {pages > 1 && (
              <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-ink-dim">
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
      className="h-7 rounded-md border border-line bg-raised px-2 text-xs capitalize text-ink focus:border-brand focus:outline-none"
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

  const meta = SEVERITY_META[incident.severity];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-void/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className={cn(
          "max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-xl border bg-surface sm:rounded-xl",
          meta.border,
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Incident ${incident.id}`}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2.5">
            <h3 className="font-semibold text-ink">{incident.label}</h3>
            <SeverityBadge severity={incident.severity} />
          </div>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X size={15} />
          </Button>
        </div>

        {incident.snapshot && (
          <img
            src={api.incidentSnapshotUrl(incident.id)}
            alt={`${incident.label} at the moment of confirmation`}
            className="w-full bg-void object-contain"
          />
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm sm:grid-cols-3">
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
      <dt className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">
        {label}
      </dt>
      <dd className="tnum mt-0.5 text-ink">{value}</dd>
    </div>
  );
}
