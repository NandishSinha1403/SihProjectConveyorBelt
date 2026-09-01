import { useEffect, useState } from 'react';
import type { LiveBeltFeed } from '@/lib/rig/useLiveBeltFeed';
import BlueprintCorners from './BlueprintCorners';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <span className="lbl">{label}</span>
      {children}
    </div>
  );
}

function timeAgo(ms: number | null, now: number): string {
  if (ms == null) return '—';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 2) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

export default function TelemetryPanel({ feed }: { feed: LiveBeltFeed }) {
  // Local 1s clock purely to keep "Xs ago" fresh — the feed itself only re-renders on a new
  // row or a connected/disconnected transition.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="ov" id="readouts">
      <div className="panel blueprint">
        <BlueprintCorners />
        <p className="kicker">Telemetry</p>
        <Row label="Device">
          <span className="num">{feed.deviceId}</span>
        </Row>
        <Row label="Connection">
          <span className={`num state${feed.connected ? '' : ' alarm'}`}>
            {feed.connected ? 'ONLINE' : 'OFFLINE'}
          </span>
        </Row>
        <Row label="Last update">
          <span className="num">{timeAgo(feed.lastUpdatedAt, now)}</span>
        </Row>
        <Row label="Status">
          <span className={`num state${feed.status === 'WARNING' ? ' alarm' : ''}`}>
            {feed.status ?? '—'}
          </span>
        </Row>
        <Row label="Vibration">
          <span>
            <span className="num">
              {feed.vibration != null ? feed.vibration.toFixed(3) : '—'}
            </span>
          </span>
        </Row>
        <Row label="Light level">
          <span>
            <span className="num">{feed.lightPercent ?? '—'}</span>
            <span className="u">%</span>
          </span>
        </Row>
        <Row label="LDR raw">
          <span className="num">{feed.ldrRaw ?? '—'}</span>
        </Row>
      </div>
    </div>
  );
}
