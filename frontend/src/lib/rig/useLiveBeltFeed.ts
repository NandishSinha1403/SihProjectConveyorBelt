import { useEffect, useState } from 'react';
import { getSupabaseClient } from './supabaseClient';

/** Belt-monitor node id, matches DEVICE_ID in belt-llive-code/firmware/belt-monitor/belt-monitor.ino. */
export const DEVICE_ID = 'belt-monitor-1';

/** Firmware posts every ~1000ms; 5x margin before declaring the rig offline. */
const OFFLINE_AFTER_MS = 5000;
const OFFLINE_CHECK_INTERVAL_MS = 1000;

export type BeltStatus = 'NORMAL' | 'WARNING';

export type LiveBeltFeed = {
  status: BeltStatus | null;
  vibration: number | null;
  ldrRaw: number | null;
  lightPercent: number | null;
  deviceId: string;
  connected: boolean;
  /** Date.now() ms at which this client last received a reading. */
  lastUpdatedAt: number | null;
};

type ReadingRow = {
  device: string;
  vibration: number;
  ldr: number;
  light_percent: number;
  status: BeltStatus;
};

function initialFeed(deviceId: string): LiveBeltFeed {
  return {
    status: null,
    vibration: null,
    ldrRaw: null,
    lightPercent: null,
    deviceId,
    connected: false,
    lastUpdatedAt: null,
  };
}

/**
 * Live telemetry for one belt-monitor device: the latest `readings` row on mount, then every
 * new row pushed over Supabase Realtime, plus a local offline detector that flips `connected`
 * to false if nothing has arrived in OFFLINE_AFTER_MS (independent of new rows arriving).
 */
export function useLiveBeltFeed(deviceId: string = DEVICE_ID): LiveBeltFeed {
  const [feed, setFeed] = useState<LiveBeltFeed>(() => initialFeed(deviceId));

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseClient();

    function applyRow(row: ReadingRow) {
      setFeed({
        status: row.status,
        vibration: row.vibration,
        ldrRaw: row.ldr,
        lightPercent: row.light_percent,
        deviceId,
        connected: true,
        lastUpdatedAt: Date.now(),
      });
    }

    // 1) latest row on mount
    (async () => {
      const { data, error } = await supabase
        .from('readings')
        .select('device, vibration, ldr, light_percent, status')
        .eq('device', deviceId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (cancelled) return;
      if (!error && data && data[0]) applyRow(data[0] as ReadingRow);
    })();

    // 2) realtime INSERTs from here on
    const channel = supabase
      .channel(`readings-${deviceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'readings', filter: `device=eq.${deviceId}` },
        (payload) => applyRow(payload.new as ReadingRow),
      )
      .subscribe();

    // 3) local offline ticker — flips `connected` even when no new rows are arriving
    const timer = setInterval(() => {
      setFeed((f) => {
        const stale = f.lastUpdatedAt == null || Date.now() - f.lastUpdatedAt > OFFLINE_AFTER_MS;
        if (f.connected === !stale) return f;
        return { ...f, connected: !stale };
      });
    }, OFFLINE_CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [deviceId]);

  return feed;
}
