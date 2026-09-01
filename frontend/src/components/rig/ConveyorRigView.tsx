import { useCallback, useEffect, useRef, useState } from 'react';
import { Moon, Sun, ArrowLeft } from 'lucide-react';
import { Link } from '@/components/Router';
import { useTheme } from '@/hooks/useTheme';
import type { Command, ConveyorRig, Fault, Telemetry } from '@/lib/rig/conveyor-model';
import type { Stage } from '@/lib/rig/stage';
import AlarmBanner from './AlarmBanner';
import ControlPanel from './ControlPanel';
import TelemetryPanel from './TelemetryPanel';
import TitlePanel from './TitlePanel';
import './rig.css';

const STAGE_BACKGROUND: Record<'light' | 'dark', string> = {
  light: '#eceef0',
  dark: '#1b1c1d',
};
const EXPORT_BASENAME = 'conveyor_health_rig';
/** Readouts refresh at 12 Hz — fast enough to read as live, far cheaper than a render per frame. */
const READOUT_INTERVAL_MS = 80;

const INITIAL_TELEMETRY: Telemetry = {
  speed: 0,
  loadTph: 0,
  beltPos: 0,
  ldr: 'CLEAR',
  ldrAlarm: false,
  mountX: -0.35,
  vision: 'CLEAR',
  visionAlarm: false,
  interlock: 'ARMED',
  tripped: false,
  tripReason: null,
};

export default function ConveyorRigView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const rigRef = useRef<ConveyorRig | null>(null);
  const labelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const labelsVisibleRef = useRef(true);

  const [anchors, setAnchors] = useState<
    Array<[string, number, number, number, number, number]>
  >([]);
  const [telemetry, setTelemetry] = useState<Telemetry>(INITIAL_TELEMETRY);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // This page's own light/dark switch -- independent of the dashboard's.
  // Defaults to light: that is the rig's native design, made in a tool that
  // only ever showed it on white.
  const { theme, toggle: toggleTheme } = useTheme('rig-theme', 'light');

  useEffect(() => {
    labelsVisibleRef.current = labelsVisible;
  }, [labelsVisible]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let stage: Stage | null = null;
    let rig: ConveyorRig | null = null;

    (async () => {
      const [{ Stage: StageClass }, model] = await Promise.all([
        import('@/lib/rig/stage'),
        import('@/lib/rig/conveyor-model'),
      ]);
      if (disposed) return;

      stage = new StageClass(host, EXPORT_BASENAME);
      stageRef.current = stage;
      setAnchors(model.LABEL_ANCHORS);

      let lastPush = 0;
      rig = model.createConveyorRig(stage, (t) => {
        projectLabels(stage!, labelRefs.current, model.LABEL_ANCHORS, labelsVisibleRef.current);
        const now = performance.now();
        if (now - lastPush < READOUT_INTERVAL_MS) return;
        lastPush = now;
        setTelemetry(t);
      });
      rigRef.current = rig;
      setReady(true);
    })().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        /webgl/i.test(msg)
          ? 'WebGL is unavailable in this view.\n' +
              'The 3D model loaded, but this browser could not create a GPU context. ' +
              'Open the page in Chrome or Safari with hardware acceleration enabled ' +
              '(Chrome: Settings → System → "Use graphics acceleration when available").\n\n' +
              msg
          : 'The 3D scene failed to start.\n\n' + msg,
      );
    });

    return () => {
      disposed = true;
      rig?.dispose();
      stage?.dispose();
      rigRef.current = null;
      stageRef.current = null;
    };
  }, []);

  const onCommand = useCallback((c: Command) => rigRef.current?.cmd(c), []);
  const onInject = useCallback((f: Fault) => rigRef.current?.inject(f), []);

  return (
    <div id="wrap" className="rig-page" data-theme={theme}>
      <div
        className="stage"
        ref={hostRef}
        style={{ ['--stage-bg' as string]: STAGE_BACKGROUND[theme] }}
      >
        <div className="stage-note">Drag to orbit · scroll to zoom · right-drag to pan</div>
        <div className="stage-toolbar">
          <Link to="/" className="rig-back" title="Back to Belt Sentinel">
            <ArrowLeft size={13} strokeWidth={1.5} />
            Belt Sentinel
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={13} strokeWidth={1.5} /> : <Moon size={13} strokeWidth={1.5} />}
          </button>
          <button type="button" disabled={!ready} onClick={() => stageRef.current?.exportObj()}>
            Download OBJ + MTL
          </button>
          <button type="button" disabled={!ready} onClick={() => stageRef.current?.exportGlb()}>
            Download GLB
          </button>
        </div>
        {error && <div className="stage-err">{error}</div>}
      </div>

      <div className="ov" id="labels">
        {anchors.map(([text], i) => (
          <div
            key={text}
            className="lab"
            ref={(node) => {
              labelRefs.current[i] = node;
            }}
          >
            {text}
          </div>
        ))}
      </div>

      <TitlePanel />
      <TelemetryPanel t={telemetry} />
      <ControlPanel
        onCommand={onCommand}
        onInject={onInject}
        labelsVisible={labelsVisible}
        onLabelsVisibleChange={setLabelsVisible}
      />
      <AlarmBanner on={telemetry.tripped} reason={telemetry.tripReason} />
    </div>
  );
}

/**
 * Project each 3D anchor to screen space. A label that lands behind the camera,
 * off-screen, or over one of the HMI panels hides itself rather than collide.
 */
function projectLabels(
  stage: Stage,
  nodes: Array<HTMLDivElement | null>,
  anchors: Array<[string, number, number, number, number, number]>,
  visible: boolean,
) {
  const { w, h } = stage.viewportSize;
  const panels = ['title', 'readouts', 'controls']
    .map((id) => document.getElementById(id)?.getBoundingClientRect())
    .filter((r): r is DOMRect => !!r);

  anchors.forEach(([, x, y, z, dx, dy], i) => {
    const n = nodes[i];
    if (!n) return;
    if (!visible) {
      n.style.display = 'none';
      return;
    }
    const v = stage.project(x, y, z);
    const px = (v.x * 0.5 + 0.5) * w + dx;
    const py = (-v.y * 0.5 + 0.5) * h + dy;
    n.style.display = 'block';
    n.style.left = px + 'px';
    n.style.top = py + 'px';
    const r = n.getBoundingClientRect();
    const clash = panels.some(
      (p) => r.right > p.left && r.left < p.right && r.bottom > p.top && r.top < p.bottom,
    );
    const onScreen = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
    n.style.display = onScreen && !clash ? 'block' : 'none';
  });
}
