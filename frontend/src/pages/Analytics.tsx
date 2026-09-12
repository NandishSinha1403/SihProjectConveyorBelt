import { useEffect, useMemo, useState } from "react";
import { api, type AnalyticsWindow } from "@/lib/api";
import type {
  GeometryResponse,
  ReliabilityIndex,
  SessionRow,
  TimeseriesResponse,
} from "@/lib/types";
import {
  buildFusionSeries,
  buildSummary,
  corroborate,
  estimatePeriod,
  motionSummary,
} from "@/lib/analytics";
import { downsample, useBeltHistory } from "@/lib/rig/useBeltHistory";
import { Button, Panel, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { VerdictBand } from "@/components/analytics/VerdictBand";
import { FusionTimeline } from "@/components/analytics/FusionTimeline";
import { DefectRegister } from "@/components/analytics/DefectRegister";
import { ConfidenceDistribution } from "@/components/analytics/ConfidenceDistribution";
import { SensorHealth } from "@/components/analytics/SensorHealth";
import { SessionLedger } from "@/components/analytics/SessionLedger";
import { cn } from "@/lib/utils";

/**
 * The diagnostics surface.
 *
 * Laid out as a report read top to bottom rather than as a grid of tiles: the
 * verdict, then the plain-English reading of it, then the evidence, then the
 * ledger the evidence came from. Someone senior enough to act on this will
 * read the first screen and stop; everything below has to justify the top.
 *
 * The two data sources are joined here and nowhere else. The backend supplies
 * the vision channel (it holds the incident database); the browser fetches the
 * ESP32 node's history directly, because the rig writes to a separate Supabase
 * project that only the frontend has credentials for.
 */

const RANGES = [
  { label: "1h", hours: 1 },
  { label: "8h", hours: 8 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "All", hours: null },
] as const;

/** Buckets across the window for the fusion timeline. */
const FUSION_BUCKETS = 96;

export function Analytics() {
  const [hours, setHours] = useState<number | null>(8);
  const [sessionId, setSessionId] = useState<number | null>(null);
  // Until the first sessions call answers we do not know which run to open on,
  // so nothing else fetches -- otherwise the page would load the 8h window and
  // then immediately reload the session one.
  const [scopeResolved, setScopeResolved] = useState(false);
  const [incidentThreshold, setIncidentThreshold] = useState<number | null>(null);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [index, setIndex] = useState<ReliabilityIndex | null>(null);
  const [series, setSeries] = useState<TimeseriesResponse | null>(null);
  const [geometry, setGeometry] = useState<GeometryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Open on the most recent run.
   *
   * A fixed look-back is the wrong default here: rig sessions are minutes long,
   * so an 8-hour window renders one run as a couple of marks at the edge of a
   * mostly-empty axis. Scoping to the latest run means every panel opens with
   * dense data and the time axis spans something that happened. The range
   * buttons are still there to widen out.
   */
  useEffect(() => {
    let cancelled = false;
    void api
      .listSessions(25)
      .then((res) => {
        if (cancelled) return;
        setSessions(res.items);
        if (res.items.length > 0) setSessionId(res.items[0].id);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setScopeResolved(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // The incident bar is operator-tunable from Settings, so the confidence chart
  // draws the live value rather than a constant that can silently go stale.
  useEffect(() => {
    let cancelled = false;
    void api
      .getSettings()
      .then((s) => !cancelled && setIncidentThreshold(s.incident_confidence_threshold))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const window: AnalyticsWindow = useMemo(
    () => ({ hours, sessionId }),
    [hours, sessionId],
  );

  useEffect(() => {
    if (!scopeResolved) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const [idx, ts, geo] = await Promise.all([
          api.reliability(window),
          api.timeseries(window, FUSION_BUCKETS),
          api.geometry(window),
        ]);
        if (cancelled) return;
        setIndex(idx);
        setSeries(ts);
        setGeometry(geo);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load analytics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [window, scopeResolved]);

  // The rig history is fetched for exactly the window the backend just
  // reported on, so the two channels describe the same stretch of time.
  const startMs = (index?.window.start ?? 0) * 1000;
  const endMs = (index?.window.end ?? 0) * 1000;
  const history = useBeltHistory(startMs, endMs);

  const motion = useMemo(() => motionSummary(history.readings), [history.readings]);
  const period = useMemo(() => estimatePeriod(history.readings), [history.readings]);
  const corroboration = useMemo(
    () => corroborate(index?.defects ?? [], history.events, history.readings),
    [index, history.events, history.readings],
  );

  const fusion = useMemo(() => {
    const span = Math.max(1, endMs - startMs);
    const bucketMs = Math.max(1000, Math.floor(span / FUSION_BUCKETS));
    return buildFusionSeries(
      series,
      downsample(history.readings, FUSION_BUCKETS),
      bucketMs,
    );
  }, [series, history.readings, startMs, endMs]);

  const summary = useMemo(
    () => buildSummary({ index, geometry, motion, corroboration, period }),
    [index, geometry, motion, corroboration, period],
  );

  if (error) {
    return (
      <Panel className="px-5 py-8">
        <p className="text-[0.9375rem] text-sev-critical">{error}</p>
        <p className="mt-2 text-[0.8125rem] text-fog">
          The analytics endpoints read the incident database directly. If the
          API is up but this failed, check that it can reach Supabase.
        </p>
      </Panel>
    );
  }

  const scoped = sessions.find((s) => s.id === sessionId);

  return (
    <div className="space-y-6">
      {/* ---- Window controls ------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[0.6875rem] uppercase tracking-[0.08em] text-fog">
          Window
        </span>
        {RANGES.map((r) => (
          <button
            key={r.label}
            type="button"
            onClick={() => {
              setHours(r.hours);
              setSessionId(null);
            }}
            className={cn(
              "rounded-[5px] border px-3 py-1.5 font-mono text-[0.75rem]",
              "transition-colors duration-200 ease-[var(--ease-focus)]",
              sessionId === null && hours === r.hours
                ? "border-signal text-signal"
                : "border-ash/70 text-fog hover:border-signal-dim hover:text-bone",
            )}
          >
            {r.label}
          </button>
        ))}

        {scoped && (
          <span className="ml-2 inline-flex items-center gap-2 rounded-full border border-signal/40 bg-signal/10 px-3 py-1 text-[0.75rem] text-signal">
            Run #{scoped.id} · {scoped.label}
            <Button
              size="sm"
              variant="ghost"
              className="h-auto p-0 text-signal hover:text-bone"
              onClick={() => setSessionId(null)}
            >
              clear
            </Button>
          </span>
        )}
      </div>

      {/* ---- Verdict ---------------------------------------------------- */}
      <VerdictBand
        index={index}
        motion={motion}
        corroboration={corroboration}
        loading={loading}
      />

      {/* ---- Smart summary ---------------------------------------------- */}
      <Panel>
        <PanelHeader title="Reading" />
        {loading ? (
          <div className="space-y-2 px-4 py-5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : summary.length === 0 ? (
          <p className="px-4 py-5 text-[0.8125rem] text-fog">
            Not enough data in this window to say anything useful.
          </p>
        ) : (
          <ul className="space-y-3 px-4 py-5">
            {summary.map((line, i) => (
              <li
                key={i}
                className="flex gap-3 text-[0.9375rem] leading-relaxed text-bone"
              >
                <span className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-signal" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-ash/70 px-4 py-2.5 text-[0.6875rem] leading-relaxed text-fog">
          Generated from the figures on this page by fixed rules — no language
          model is involved, and a claim only appears when the data supports it.
        </p>
      </Panel>

      {/* ---- The fusion timeline ---------------------------------------- */}
      <FusionTimeline
        data={fusion}
        hasSensor={history.readings.length > 0}
        loading={loading || history.loading}
      />

      {/* ---- What to act on, and where ---------------------------------- */}
      <DefectRegister defects={index?.defects ?? []} />

      {/* ---- Instrument trust ------------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ConfidenceDistribution
          points={geometry?.scatter ?? []}
          incidentThreshold={incidentThreshold}
        />
        <SensorHealth
          readings={history.readings}
          motion={motion}
          period={period}
          configured={history.configured}
          error={history.error}
        />
      </div>

      <PipelineIntegrity index={index} />

      {/* ---- Ledger ----------------------------------------------------- */}
      <SessionLedger
        sessions={sessions}
        selectedId={sessionId}
        onSelect={setSessionId}
      />
    </div>
  );
}

/**
 * Frame accounting.
 *
 * `frames_skipped` is the number this project has always been proudest of --
 * it is the proof the pipeline is genuinely real-time rather than batching --
 * and it is also the number that qualifies every finding above, because a
 * skipped frame is belt that passed the camera unseen.
 */
function PipelineIntegrity({ index }: { index: ReliabilityIndex | null }) {
  if (!index) {
    return (
      <Panel>
        <PanelHeader title="Inspection integrity" />
        <Skeleton className="m-4 h-24" />
      </Panel>
    );
  }

  const { frames_read: read, frames_processed: processed, frames_skipped: skipped } =
    index.frames;
  const pct = read > 0 ? processed / read : null;

  return (
    <Panel>
      <PanelHeader title="Inspection integrity" />
      <div className="px-4 py-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[0.8125rem] text-fog">
            Frames analysed of frames that arrived
          </span>
          <span className="tnum text-[1.375rem] leading-none text-bone">
            {pct === null ? "—" : `${Math.round(pct * 100)}%`}
          </span>
        </div>

        <div className="mt-3 h-px w-full bg-ash">
          <div
            className="h-px origin-left bg-signal transition-transform duration-500 ease-[var(--ease-focus)]"
            style={{ transform: `scaleX(${pct ?? 0})` }}
          />
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-4">
          {[
            ["Read", read],
            ["Analysed", processed],
            ["Skipped", skipped],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-[0.6875rem] uppercase tracking-[0.08em] text-fog">
                {label}
              </dt>
              <dd className="tnum mt-1 text-[1.0625rem] text-bone">
                {(value as number).toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-5 text-[0.75rem] leading-relaxed text-fog">
          Skipped frames arrived while the detector was still working on an
          earlier one and were discarded rather than queued — that is what makes
          this a live monitor rather than a batch process. It also means the
          belt they carried went uninspected, which is why coverage qualifies
          the score above.
        </p>
      </div>
      <p className="border-t border-ash/70 px-4 py-2.5 text-[0.6875rem] text-fog">
        Across {index.sessions} {index.sessions === 1 ? "run" : "runs"} in this window.
      </p>
    </Panel>
  );
}
