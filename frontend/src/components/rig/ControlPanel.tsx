import { useState } from 'react';
import type { Command, Fault } from '@/lib/rig/conveyor-model';
import BlueprintCorners from './BlueprintCorners';

type Props = {
  onCommand: (c: Command) => void;
  onInject: (f: Fault) => void;
  labelsVisible: boolean;
  onLabelsVisibleChange: (on: boolean) => void;
};

export default function ControlPanel({
  onCommand,
  onInject,
  labelsVisible,
  onLabelsVisibleChange,
}: Props) {
  const [speed, setSpeed] = useState(1.8);
  const [load, setLoad] = useState(55);
  const [mountX, setMountX] = useState(-0.35);
  const [oreFeed, setOreFeed] = useState(true);

  return (
    <div className="ov" id="controls">
      <div className="panel blueprint">
        <BlueprintCorners />
        <p className="kicker">Control</p>
        <div className="btnrow field-mb3">
          <button className="btn btn-primary" onClick={() => onCommand({ k: 'start' })}>
            Start
          </button>
          <button className="btn btn-secondary" onClick={() => onCommand({ k: 'stop' })}>
            Stop
          </button>
          <button
            className="btn btn-secondary btn-estop"
            onClick={() => onCommand({ k: 'estop' })}
          >
            E-Stop
          </button>
          <button className="btn btn-ghost" onClick={() => onCommand({ k: 'reset' })}>
            Reset interlock
          </button>
        </div>

        <div className="cols">
          <div>
            <div className="field field-mb2">
              <label htmlFor="s-speed">
                Speed setpoint — <span className="num">{speed.toFixed(2)}</span> m/s
              </label>
              <input
                type="range"
                id="s-speed"
                min={0}
                max={3}
                step={0.05}
                value={speed}
                onChange={(e) => {
                  const v = +e.target.value;
                  setSpeed(v);
                  onCommand({ k: 'speed', v });
                }}
              />
            </div>
            <div className="field field-mb3">
              <label htmlFor="s-load">
                Load — <span className="num">{load}</span> %
              </label>
              <input
                type="range"
                id="s-load"
                min={0}
                max={100}
                step={1}
                value={load}
                onChange={(e) => {
                  const v = +e.target.value;
                  setLoad(v);
                  onCommand({ k: 'load', v: v / 100 });
                }}
              />
            </div>
          </div>

          <div>
            <p className="kicker kicker-top">Overhead laser mount</p>
            <div className="field field-mb3">
              <label htmlFor="s-mx">
                Mount X — <span className="num">{mountX.toFixed(2)}</span> m
              </label>
              <input
                type="range"
                id="s-mx"
                min={-1.4}
                max={1.4}
                step={0.01}
                value={mountX}
                onChange={(e) => {
                  const v = +e.target.value;
                  setMountX(v);
                  onCommand({ k: 'mount_x', v });
                }}
              />
            </div>

            <p className="kicker kicker-top">Fault injection</p>
            <div className="btnrow">
              <button className="btn btn-secondary" onClick={() => onInject('oversize')}>
                Oversize rock
              </button>
              <button className="btn btn-secondary" onClick={() => onInject('rip')}>
                Belt hole / rip
              </button>
              <button className="btn btn-secondary" onClick={() => onInject('trip')}>
                Trip interlock (2/3)
              </button>
              <button className="btn btn-ghost" onClick={() => onCommand({ k: 'clear_ore' })}>
                Clear rocks
              </button>
              <label className="sw">
                <input
                  type="checkbox"
                  checked={oreFeed}
                  onChange={(e) => {
                    setOreFeed(e.target.checked);
                    onCommand({ k: 'ore', v: e.target.checked });
                  }}
                />{' '}
                Ore feed
              </label>
              <label className="sw">
                <input
                  type="checkbox"
                  checked={labelsVisible}
                  onChange={(e) => onLabelsVisibleChange(e.target.checked)}
                />{' '}
                Labels
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
