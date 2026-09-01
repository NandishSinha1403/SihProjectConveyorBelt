import BlueprintCorners from './BlueprintCorners';

export default function TitlePanel() {
  return (
    <div className="ov" id="title">
      <div className="panel blueprint">
        <BlueprintCorners />
        <p className="kicker">SIH26008 · Team Unplayed</p>
        <h1>Conveyor Belt Health Monitoring Rig</h1>
        <p>
          Sensor layout and motion bound to simulated telemetry — downward rip lasers reading the
          belt against an LDR array between the runs, CNN vision camera, head-bearing
          accelerometer. Drag to orbit; download OBJ or GLB from the toolbar.
        </p>
      </div>
    </div>
  );
}
