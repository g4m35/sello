import type { ReactNode } from "react";

import { BrandLoader } from "@/components/ui/brand-loader";
import { Icon, type IconName } from "@/components/ui/icon";

export function EmptyState({
  icon = "package",
  title,
  desc,
  actions,
}: {
  icon?: IconName;
  title: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__art">
        <Icon name={icon} size={32} />
      </div>
      <div className="empty__title">{title}</div>
      {desc && <div className="empty__desc">{desc}</div>}
      {actions && <div className="row" style={{ marginTop: 4 }}>{actions}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty">
      <div className="empty__art" style={{ color: "var(--accent)" }}>
        <Icon name="alert" size={32} />
      </div>
      <div className="empty__title">Something went wrong</div>
      <div className="empty__desc">{message}</div>
      {onRetry && (
        <button className="btn btn--secondary" onClick={onRetry}>
          <Icon name="refresh" size={14} /> Try again
        </button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="row"
          style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", gap: 14 }}
        >
          <div className="skel" style={{ width: 40, height: 40, borderRadius: 6 }} />
          <div style={{ flex: 1 }}>
            <div className="skel" style={{ width: "40%", height: 12, marginBottom: 8 }} />
            <div className="skel" style={{ width: "24%", height: 10 }} />
          </div>
          <div className="skel" style={{ width: 70, height: 22, borderRadius: 999 }} />
          <div className="skel" style={{ width: 90, height: 12 }} />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <main className="page page--loading">
      <div className="page-loading">
        <BrandLoader label={label} size={72} />
      </div>
    </main>
  );
}
