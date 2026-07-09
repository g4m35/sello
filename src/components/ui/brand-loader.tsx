export type BrandLoaderProps = {
  label?: string;
  size?: number;
  className?: string;
  compact?: boolean;
};

/**
 * Lightweight branded loading mark — soft ring + Sello wordmark.
 */
export function BrandLoader({
  label = "Loading",
  size = 72,
  className,
  compact = false,
}: BrandLoaderProps) {
  return (
    <div
      className={["brand-loader", compact ? "brand-loader--compact" : "", className]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div
        className="brand-loader__mark"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <span className="brand-loader__ring" />
        <span className="brand-loader__word">
          S<em>.</em>
        </span>
      </div>
      {!compact && (
        <span className="brand-loader__label">
          {label}
          <span className="brand-loader__ellipsis" aria-hidden="true">
            …
          </span>
        </span>
      )}
    </div>
  );
}
