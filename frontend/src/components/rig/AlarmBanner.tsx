export default function AlarmBanner({
  on,
  reason,
}: {
  on: boolean;
  reason: string | null;
}) {
  return (
    <div className={`ov${on ? ' on' : ''}`} id="banner">
      <span>⚠ Interlock tripped</span>
      <span className="reason">{reason ?? ''}</span>
    </div>
  );
}
