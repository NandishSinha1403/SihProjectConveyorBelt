import { useEffect, useState } from "react";
import { getSupabaseClient } from "./supabaseClient";
import { DEVICE_ID } from "./useLiveBeltFeed";

/**
 * Historical telemetry from the belt-monitor node.
 *
 * `useLiveBeltFeed` reads exactly one row -- the latest -- and subscribes to
 * new ones, which is all the 3D Model needs. Everything the node has ever
 * written has therefore gone unread, including the entire `events` table. This
 * hook is what the analytics page uses to read it.
 *
 * Two things this has to be careful about.
 *
 * *Volume.* The firmware posts about once a second, so an eight-hour window is
 * roughly 28,800 rows. They are downsampled into buckets before anything is
 * charted; pulling them into component state raw would be a needless several
 * megabytes and a sluggish page.
 *
 * *Clocks.* `readings.created_at` is stamped by Supabase's `now()`, while an
 * incident's `opened_at` comes from `time.time()` on whichever machine runs
 * the API. They are different clocks and are not aligned to the second. Any
 * correlation between the two channels has to carry a tolerance, and the page
 * has to say so rather than implying a precision it does not have.
 */

/** Hard ceiling on rows fetched per request, so a wide window cannot hang the tab. */
const MAX_ROWS = 5000;

export type BeltStatus = "NORMAL" | "WARNING";

export interface ReadingSample {
  /** Epoch milliseconds, converted from `created_at` on arrival. */
  t: number;
  vibration: number;
  ldr: number;
  lightPercent: number;
  status: BeltStatus;
}

export interface RuptureEvent {
  t: number;
  vibration: number;
  ldr: number;
}

export interface BeltHistory {
  readings: ReadingSample[];
  events: RuptureEvent[];
  loading: boolean;
  /**
   * Null while loading or on success. A message here means the rig project is
   * unreachable or unconfigured -- which is NOT the same as the node having
   * reported nothing, and the two must render differently.
   */
  error: string | null;
  /** False when VITE_SUPABASE_URL / ANON_KEY are absent. */
  configured: boolean;
}

const EMPTY: BeltHistory = {
  readings: [],
  events: [],
  loading: false,
  error: null,
  configured: false,
};

/**
 * Reduce a run of samples to at most `target` evenly spaced buckets.
 *
 * Vibration is averaged but also carries its bucket maximum, because a rupture
 * is a spike: averaging alone would smooth away the very event the chart
 * exists to show. Status is sticky -- if any sample in a bucket said WARNING,
 * the bucket says WARNING, since a warning that lasted two seconds out of
 * sixty still happened.
 */
export function downsample(rows: ReadingSample[], target: number): Array<
  ReadingSample & { vibrationMax: number; count: number }
> {
  if (rows.length === 0) return [];
  if (rows.length <= target) {
    return rows.map((r) => ({ ...r, vibrationMax: r.vibration, count: 1 }));
  }

  const start = rows[0].t;
  const end = rows[rows.length - 1].t;
  const span = Math.max(1, end - start);
  const width = span / target;

  const buckets = new Map<number, ReadingSample[]>();
  for (const r of rows) {
    const key = Math.min(target - 1, Math.floor((r.t - start) / width));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(r);
    else buckets.set(key, [r]);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, group]) => {
      const n = group.length;
      const sum = (pick: (s: ReadingSample) => number) =>
        group.reduce((acc, s) => acc + pick(s), 0);
      return {
        t: Math.round(start + (key + 0.5) * width),
        vibration: sum((s) => s.vibration) / n,
        vibrationMax: Math.max(...group.map((s) => s.vibration)),
        ldr: Math.round(sum((s) => s.ldr) / n),
        lightPercent: Math.round(sum((s) => s.lightPercent) / n),
        status: group.some((s) => s.status === "WARNING") ? "WARNING" : "NORMAL",
        count: n,
      };
    });
}

/**
 * Readings and rupture events for a device between two epoch-millisecond
 * timestamps. Refetches whenever the window moves.
 */
export function useBeltHistory(
  startMs: number,
  endMs: number,
  deviceId: string = DEVICE_ID,
): BeltHistory {
  const [state, setState] = useState<BeltHistory>({ ...EMPTY, loading: true });

  useEffect(() => {
    let cancelled = false;

    if (!(endMs > startMs)) {
      setState({ ...EMPTY, configured: true });
      return;
    }

    let supabase;
    try {
      supabase = getSupabaseClient();
    } catch {
      // Missing env vars. Reported as "not configured" rather than as an
      // error, because there is nothing wrong -- the rig integration simply
      // is not set up on this deployment.
      setState({ ...EMPTY, configured: false });
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null, configured: true }));

    const from = new Date(startMs).toISOString();
    const to = new Date(endMs).toISOString();

    void (async () => {
      try {
        const [readingsRes, eventsRes] = await Promise.all([
          supabase
            .from("readings")
            .select("vibration, ldr, light_percent, status, created_at")
            .eq("device", deviceId)
            .gte("created_at", from)
            .lte("created_at", to)
            .order("created_at", { ascending: true })
            .limit(MAX_ROWS),
          supabase
            .from("events")
            .select("vibration, ldr, created_at")
            .eq("device", deviceId)
            .gte("created_at", from)
            .lte("created_at", to)
            .order("created_at", { ascending: true })
            .limit(MAX_ROWS),
        ]);

        if (cancelled) return;
        if (readingsRes.error) throw new Error(readingsRes.error.message);
        if (eventsRes.error) throw new Error(eventsRes.error.message);

        setState({
          configured: true,
          loading: false,
          error: null,
          readings: (readingsRes.data ?? []).map((r) => ({
            t: new Date(r.created_at as string).getTime(),
            vibration: Number(r.vibration) || 0,
            ldr: Number(r.ldr) || 0,
            lightPercent: Number(r.light_percent) || 0,
            status: (r.status === "WARNING" ? "WARNING" : "NORMAL") as BeltStatus,
          })),
          events: (eventsRes.data ?? []).map((e) => ({
            t: new Date(e.created_at as string).getTime(),
            vibration: Number(e.vibration) || 0,
            ldr: Number(e.ldr) || 0,
          })),
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          ...EMPTY,
          configured: true,
          error: err instanceof Error ? err.message : "Could not reach the rig project",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [startMs, endMs, deviceId]);

  return state;
}
