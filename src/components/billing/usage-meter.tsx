// Presentational usage bar: shows count / limit for one metric this period.
// Pure (no data fetching) so it is trivially testable and reusable.
export function UsageMeter({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const atLimit = used >= limit;

  return (
    <div className="usage-meter">
      <div className="usage-meter__head">
        <span>{label}</span>
        <span className={atLimit ? "usage-meter__value usage-meter__value--limit" : "usage-meter__value"}>
          {used} / {limit}
        </span>
      </div>
      <div className="usage-meter__track">
        <div
          className={`usage-meter__fill ${atLimit ? "usage-meter__fill--limit" : ""}`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-label={label}
        />
      </div>
    </div>
  );
}
