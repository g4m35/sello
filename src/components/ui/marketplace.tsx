import { mpLogo } from "@/lib/view/marketplaces";
import type { ChannelStateView, DesignStatus } from "@/lib/view/types";
import type { CSSProperties } from "react";

/* ---------------- Marketplace logo (text mark) ---------------- */
export function MpLogo({ id, size = 28, square = true }: { id: string; size?: number; square?: boolean }) {
  const m = mpLogo(id);
  return (
    <div
      className="marketplace-logo"
      style={{
        width: size,
        height: size,
        borderRadius: square ? 6 : "50%",
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

export function Thumb({
  image,
  size = 44,
  className = "",
}: {
  image?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={`table__thumb product-thumb ${image ? "product-thumb--image" : "product-thumb--empty"} ${className}`}
      style={{ width: size, height: size, "--thumb-size": `${size}px` } as CSSProperties}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" />
      ) : (
        <span className="product-thumb__mark" aria-hidden="true">
          S<em>.</em>
        </span>
      )}
    </div>
  );
}
