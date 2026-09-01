import BlueprintCorners from './BlueprintCorners';

export default function TitlePanel({
  labelsVisible,
  onLabelsVisibleChange,
}: {
  labelsVisible: boolean;
  onLabelsVisibleChange: (on: boolean) => void;
}) {
  return (
    <div className="ov" id="title">
      <div className="panel blueprint">
        <BlueprintCorners />
        <p className="kicker">SIH26008 · Team Unplayed</p>
        <h1>Conveyor Belt Health Monitoring Rig</h1>
        <p>
          Live rig fed by an ESP32 belt-monitor node over Supabase — vibration-driven jitter and
          belt-rupture detection bound to real accelerometer and LDR readings. Drag to orbit;
          download OBJ or GLB from the toolbar.
        </p>
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
  );
}
