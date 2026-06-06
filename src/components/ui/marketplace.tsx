import { mpLogo } from "@/lib/view/marketplaces";
import type { ChannelStateView, DesignStatus } from "@/lib/view/types";

/* ---------------- Marketplace logo (text mark) ---------------- */
export function MpLogo({ id, size = 28, square = true }: { id: string; size?: number; square?: boolean }) {
  const m = mpLogo(id);
  return (
    <div
      style={{
        width: size,
        height: size,
        background: m.color,
        color: "white",
        borderRadius: square ? 4 : "50%",
        display: "grid",
        placeItems: "center",
        fontFamily: "var(--font-mono)",
        fontSize: size * 0.36,
        fontWeight: 600,
        letterSpacing: "-0.02em",
        flexShrink: 0,
      }}
    >
      {m.label}
    </div>
  );
}

/* ---------------- Marketplace status dot (table cell) ---------------- */
export function MpDot({ marketplace, status }: { marketplace: string; status: DesignStatus }) {
  const m = mpLogo(marketplace);
  return (
    <span className={`mp-dot mp-dot--${status}`} title={`${marketplace}: ${status}`}>
      {m.label}
    </span>
  );
}

export function MpDots({ channels }: { channels: Pick<ChannelStateView, "marketplace" | "status">[] }) {
  return (
    <span className="mp-dots">
      {channels.map((c) => (
        <MpDot key={c.marketplace} marketplace={c.marketplace} status={c.status} />
      ))}
    </span>
  );
}

/* ---------------- Product thumbnail (deterministic placeholder) ---------------- */
const PALETTES: [string, string][] = [
  ["#E8E5D6", "#0B0B0A"],
  ["#F2DDD0", "#3A3A37"],
  ["#D6DCE5", "#0B0B0A"],
  ["#E0E6D6", "#2A4218"],
  ["#F2C9C5", "#8C1814"],
  ["#EAE4D5", "#5A4818"],
  ["#1A1A18", "#FAF9F5"],
  ["#D8D6CB", "#0B0B0A"],
  ["#F5E6D3", "#6B4423"],
  ["#C5CFC7", "#1F3A28"],
  ["#E8D9E5", "#4A2D4F"],
  ["#D0D8E0", "#1F2A38"],
];

// Deterministic hash so the same item always renders the same placeholder.
function seedFrom(seed: number | string): number {
  if (typeof seed === "number") return seed;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

export function Thumb({
  seed = 0,
  size = 44,
  className = "",
}: {
  seed?: number | string;
  size?: number;
  className?: string;
}) {
  const s = seedFrom(seed);
  const [bg, fg] = PALETTES[s % PALETTES.length];
  const shape = s % 4;
  return (
    <div
      className={`table__thumb ${className}`}
      style={{ width: size, height: size, background: bg, display: "grid", placeItems: "center" }}
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
        {shape === 0 && <path d="M2 16c0-1 1-3 3-3l3-1 2-3c1-1 3-1 4 0l1 2 4 1c2 0 4 1 4 3v2H2v-1z" fill={fg} />}
        {shape === 1 && <path d="M6 4l2-1 4 2 4-2 2 1 3 3-2 3-2-1v11H7V9L5 10 3 7z" fill={fg} />}
        {shape === 2 && (
          <>
            <path d="M5 8h14l-1 13H6L5 8z" fill={fg} />
            <path d="M9 8V6a3 3 0 0 1 6 0v2" stroke={fg} strokeWidth="1.6" fill="none" />
          </>
        )}
        {shape === 3 && <path d="M12 3l8 4v10l-8 4-8-4V7l8-4zM4 7l8 4 8-4M12 11v10" stroke={fg} strokeWidth="1.4" fill="none" />}
      </svg>
    </div>
  );
}
