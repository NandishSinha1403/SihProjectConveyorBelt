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
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button, EmptyState, Panel, PanelHeader } from "@/components/ui/primitives";
import type { SessionRow } from "@/lib/types";
import { cn, formatDateTime, formatDuration } from "@/lib/utils";

/**
 * Every run the system has made, and what each one found.
 *
 * The `sessions` table has been written on every run since the schema was
 * created and read back by nothing at all -- no endpoint queried it. This is
 * the first surface that does.
 *
 * Coverage is the column worth reading. A run with a low skip ratio inspected
 * nearly all of the belt that passed it; a run with a high one did not, and its
 * incident count is a floor rather than a total.
 */
/**
 * TanStack Table v9 is opt-in: a table gets only the features it registers,
 * and unregistered ones are not in the bundle. Sorting is all this table
 * needs -- the run list is short enough that filtering and pagination would
 * be chrome for its own sake.
 */
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic },
});

const column = createColumnHelper<typeof features, SessionRow>();

export function SessionLedger({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: SessionRow[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "started_at", desc: true },
  ]);

  // ColumnDef is invariant in its value type, so an array mixing number and
  // string accessors will not collapse to a single element type on its own.
  // `any` in that one slot is TanStack's own documented answer; every cell
  // renderer below still gets its real type from the column helper.
  const columns = useMemo<ColumnDef<typeof features, SessionRow, any>[]>(
    () => [
      column.accessor("id", {
        header: "Run",
        cell: (c) => (
          <span className="tnum text-fog">#{c.getValue()}</span>
        ),
      }),
      column.accessor("started_at", {
        header: "Started",
        cell: (c) => (
          <span className="tnum whitespace-nowrap">
            {formatDateTime(c.getValue())}
          </span>
        ),
      }),
      column.accessor(
        // A run with no `ended_at` either is still going or was cut off before
        // it could close itself. Measuring the second kind against the clock
        // reports "33h 23m" for a session that died in seconds, so only a run
        // that is genuinely live gets measured that way.
        (r) => (r.ended_at !== null ? r.ended_at - r.started_at : r.is_live ? -1 : -2),
        {
          id: "duration",
          header: "Duration",
          cell: (c) => {
            const v = c.getValue();
            if (v === -1) {
              return <span className="whitespace-nowrap text-signal">running</span>;
            }
            if (v === -2) {
              return (
                <span
                  className="whitespace-nowrap text-fog"
                  title="This run never recorded an end — the process stopped before it could close the session"
                >
                  interrupted
                </span>
              );
            }
            return (
              <span className="tnum whitespace-nowrap">{formatDuration(v)}</span>
            );
          },
        },
      ),
      column.accessor("label", {
        header: "Source",
        cell: (c) => (
          <span className="block max-w-[22ch] truncate" title={c.row.original.source_uri}>
            {c.getValue()}
          </span>
        ),
      }),
      column.accessor("incident_count", {
        header: "Sightings",
        cell: (c) => <span className="tnum">{c.getValue()}</span>,
      }),
      column.accessor("critical_count", {
        header: "Critical",
        cell: (c) => {
          const n = c.getValue();
          return (
            <span className={cn("tnum", n > 0 ? "text-sev-critical" : "text-fog")}>
              {n}
            </span>
          );
        },
      }),
      column.accessor(
        // A run that read no frames has no coverage, which is not 0% -- sorting
        // must not rank it alongside a run that genuinely missed everything.
        (r) => (r.frames_read > 0 ? r.frames_processed / r.frames_read : -1),
        {
          id: "coverage",
          header: "Coverage",
          cell: (c) => {
            const v = c.getValue();
            if (v < 0) return <span className="text-fog">—</span>;
            const pct = Math.round(v * 100);
            return (
              <span className={cn("tnum", pct < 85 ? "text-sev-medium" : "text-bone")}>
                {pct}%
              </span>
            );
          },
        },
      ),
    ],
    [],
  );

  const table = useTable({
    features,
    data: sessions,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
  });

  return (
    <Panel>
      <PanelHeader
        title="Run ledger"
        action={
          selectedId !== null && (
            <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
              Clear filter
            </Button>
          )
        }
      />

      {sessions.length === 0 ? (
        <EmptyState
          title="No runs recorded yet."
          hint="Every time the pipeline starts on a source it opens a run here, with its frame accounting and what it found."
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
                          "cursor-pointer select-none whitespace-nowrap px-4 py-2.5",
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
              {table.getRowModel().rows.map((row) => {
                const active = row.original.id === selectedId;
                return (
                  <tr
                    key={row.id}
                    onClick={() =>
                      onSelect(active ? null : row.original.id)
                    }
                    className={cn(
                      "cursor-pointer border-b border-ash/40 text-bone",
                      "transition-colors duration-150 ease-[var(--ease-focus)]",
                      active ? "bg-raised" : "hover:bg-raised",
                    )}
                  >
                    {row.getAllCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-2.5">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="border-t border-ash/70 px-4 py-2.5 text-[0.6875rem] leading-relaxed text-fog">
        The 25 most recent runs. Select one to scope every panel on this page to
        it. "Sightings" counts
        incident rows, not distinct defects — a defect on a loop is logged again
        each revolution.
      </p>
    </Panel>
  );
}
