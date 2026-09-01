import type { Telemetry } from '@/lib/rig/conveyor-model';
import BlueprintCorners from './BlueprintCorners';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <span className="lbl">{label}</span>
      {children}
    </div>
  );
}

export default function TelemetryPanel({ t }: { t: Telemetry }) {
  return (
    <div className="ov" id="readouts">
      <div className="panel blueprint">
        <BlueprintCorners />
        <p className="kicker">Telemetry</p>
        <Row label="Belt speed">
          <span>
            <span className="num">{t.speed.toFixed(2)}</span>
            <span className="u">m/s</span>
          </span>
        </Row>
        <Row label="Load">
          <span>
            <span className="num">{t.loadTph}</span>
            <span className="u">t/h</span>
          </span>
        </Row>
        <Row label="Belt position">
          <span>
            <span className="num">{t.beltPos.toFixed(1)}</span>
            <span className="u">m</span>
          </span>
        </Row>
        <Row label="LDR / rip">
          <span className={`num state${t.ldrAlarm ? ' alarm' : ''}`}>{t.ldr}</span>
        </Row>
        <Row label="Mount X">
          <span>
            <span className="num">{t.mountX.toFixed(2)}</span>
            <span className="u">m</span>
          </span>
        </Row>
        <Row label="CNN vision">
          <span className={`num state${t.visionAlarm ? ' alarm' : ''}`}>{t.vision}</span>
        </Row>
        <Row label="Interlock">
          <span className={`num state${t.tripped ? ' alarm' : ''}`}>{t.interlock}</span>
        </Row>
      </div>
    </div>
  );
}
