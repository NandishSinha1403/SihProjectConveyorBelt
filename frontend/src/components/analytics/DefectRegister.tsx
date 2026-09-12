import { useMemo, useState } from "react";
import {
  createColumnHelper,
  createSortedRowModel,
  flexRender,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  useTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ImageOff } from "lucide-react";
import { api } from "@/lib/api";
import type { DistinctDefect, Severity } from "@/lib/types";
import {
  EmptyState,
  Panel,
  PanelHeader,
  SeverityBadge,
  SnapshotImage,
} from "@/components/ui/primitives";
import { cn, formatDateTime } from "@/lib/utils";

/**
 * The work list: which defect to deal with first, and the evidence for it.
 *
 * This replaces a scatter of size against confidence, which plotted two columns
 * that happened to exist rather than answering anything. The question an
 * engineer actually arrives with is "which one do I send someone to?", and the
 * answer is a ranked list, not a cloud of dots.
 *
 * It also makes the score auditable. Each row carries its own contribution to
 * the condition index, so "why is this belt a 40?" is answered by reading down
 * a column rather than by trusting the gauge.
 *
 * One row per *distinct physical defect*, not per incident row -- the belt is a
 * loop, so a single tear is logged again every revolution. `sightings` is how
 * many times it came round.
 */

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic },
});

const column = createColumnHelper<typeof features, DistinctDefect>();

export function DefectRegister({ defects }: { defects: DistinctDefect[] }) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "penalty", desc: true },
  ]);

  const columns = useMemo<ColumnDef<typeof features, DistinctDefect, any>[]>(
    () => [
      column.display({
        id: "evidence",
        header: "",
        cell: (c) => {
          const ids = c.row.original.incident_ids;
          if (ids.length === 0) return null;
          return (
            <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded-[3px] border border-ash/70 bg-pitch">
              <SnapshotImage
                src={api.incidentSnapshotUrl(ids[0])}
                alt=""
                className="h-full w-full object-cover"
              />
              <ImageOff
                size={12}
                strokeWidth={1.25}
                className="absolute inset-0 m-auto -z-10 text-fog"
              />
            </div>
          );
        },
      }),
      column.accessor("severity", {
        header: "Severity",
        cell: (c) => <SeverityBadge severity={c.getValue() as Severity} />,
        sortFn: (a, b) =>
          SEVERITY_RANK[a.original.severity] - SEVERITY_RANK[b.original.severity],
      }),
      column.accessor("label", {
        header: "Defect",
        cell: (c) => <span className="whitespace-nowrap">{c.getValue()}</span>,
      }),
      column.accessor((d) => d.lateral ?? -1, {
        id: "lateral",
        header: "Across belt",
        cell: (c) => {
          const v = c.getValue();
          if (v < 0) return <span className="text-fog">—</span>;
          return (
            <div className="flex items-center gap-2">
              <span className="tnum w-9 shrink-0">{Math.round(v * 100)}%</span>
              {/* The position, drawn. Reading a percentage takes a beat; seeing
                  where the tick sits does not. */}
              <span className="relative h-3 w-14 shrink-0 border-x border-ash/70">
                <span className="absolute inset-x-0 top-1/2 h-px bg-ash" />
                <span
                  className="absolute top-0 h-3 w-px bg-bone"
                  style={{ left: `${v * 100}%` }}
                />
              </span>
            </div>
          );
        },
      }),
      column.accessor("area", {
        header: "Size",
        cell: (c) => (
          <span className="tnum">{(c.getValue() * 100).toFixed(2)}%</span>
        ),
      }),
      column.accessor("sightings", {
        header: "Revolutions",
        cell: (c) => <span className="tnum">{c.getValue()}</span>,
      }),
      column.accessor("confidence", {
        header: "Confidence",
        cell: (c) => <span className="tnum">{c.getValue().toFixed(2)}</span>,
      }),
      column.accessor("first_seen", {
        header: "First seen",
        cell: (c) => (
          <span className="tnum whitespace-nowrap text-fog">
            {formatDateTime(c.getValue())}
          </span>
        ),
      }),
      column.accessor("penalty", {
        header: "Score cost",
        cell: (c) => (
          <span className="tnum text-bone">{c.getValue().toFixed(1)}</span>
        ),
      }),
    ],
    [],
  );

  const table = useTable({
    features,
    data: defects,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
  });

  const totalPenalty = defects.reduce((sum, d) => sum + d.penalty, 0);

  return (
    <Panel>
      <PanelHeader
        title="Defect register"
        action={
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.06em] text-fog">
            {defects.length} distinct
          </span>
        }
      />

      {defects.length === 0 ? (
        <EmptyState
          title="No confirmed defects in this window."
          hint="Each distinct defect appears here once, worst first, with the evidence image the pipeline captured when it opened."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8125rem]">
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id} className="border-b border-ash/70">
                  {group.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "cursor-pointer select-none whitespace-nowrap px-3 py-2.5",
                          "text-left text-[0.6875rem] uppercase tracking-[0.08em]",
                          "text-fog hover:text-bone",
                        )}
                      >
                        <span className="inline-flex items-center gap-1">
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {sorted === "asc" && <ArrowUp size={11} strokeWidth={1.5} />}
                          {sorted === "desc" && <ArrowDown size={11} strokeWidth={1.5} />}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-ash/40 text-bone transition-colors duration-150 ease-[var(--ease-focus)] hover:bg-raised"
                >
                  {row.getAllCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2.5 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {defects.length > 0 && (
        <p className="border-t border-ash/70 px-4 py-2.5 text-[0.6875rem] leading-relaxed text-fog">
          "Score cost" is each defect's contribution to the condition index —
          severity weighted by confidence, size and how many revolutions it
          survived. They total{" "}
          <span className="tnum text-bone">{totalPenalty.toFixed(1)}</span>, which
          is what the headline score is computed from. "Revolutions" is how many
          times the camera logged this same defect coming back round.
        </p>
      )}
    </Panel>
  );
}

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};
