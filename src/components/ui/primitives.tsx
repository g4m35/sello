import type { ButtonHTMLAttributes, ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/icon";
import { DESIGN_STATUS_LABEL } from "@/lib/view/status";
import type { DesignStatus } from "@/lib/view/types";

/* ---------------- Badge ---------------- */
export function Badge({
  status,
  label,
  className = "",
  outline,
}: {
  status?: DesignStatus;
  label?: ReactNode;
  className?: string;
  outline?: boolean;
}) {
  const cls = outline ? "badge badge--outline" : `badge badge--${status ?? "draft"}`;
  return (
    <span className={`${cls} ${className}`}>
      {!outline && <span className="badge__dot" />}
      {label ?? (status ? DESIGN_STATUS_LABEL[status] : "")}
    </span>
  );
}

/* ---------------- Button ---------------- */
type BtnProps = {
  variant?: "primary" | "accent" | "secondary" | "ghost";
  size?: "sm" | "lg";
  icon?: IconName;
  iconRight?: IconName;
  kbd?: string;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function Btn({
  variant = "secondary",
  size,
  icon,
  iconRight,
  kbd,
  children,
  className = "",
  disabled,
  ...rest
}: BtnProps) {
  const cls = [
    "btn",
    `btn--${variant}`,
    size && `btn--${size}`,
    !children && "btn--icon",
    disabled && "btn--disabled",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} disabled={disabled} {...rest}>
      {icon && <Icon name={icon} size={size === "sm" ? 13 : 14} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === "sm" ? 13 : 14} />}
      {kbd && <span className="btn__kbd">{kbd}</span>}
    </button>
  );
}

/* ---------------- Checkbox ---------------- */
export function Check({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange?.(!checked);
      }}
      className={`checkbox ${checked ? "checkbox--checked" : ""} ${disabled ? "checkbox--disabled" : ""}`}
      aria-checked={checked}
      role="checkbox"
    >
      {checked && <Icon name="check" size={11} strokeWidth={2.6} />}
    </button>
  );
}

/* ---------------- Toggle ---------------- */
export function Toggle({ on, onChange }: { on: boolean; onChange?: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange?.(!on)}
      className={`toggle ${on ? "toggle--on" : ""}`}
      aria-pressed={on}
    >
      <span className="toggle__knob" />
    </button>
  );
}

/* ---------------- Ring ---------------- */
export function Ring({ pct = 50, size = 48, color }: { pct?: number; size?: number; color?: string }) {
  const c = color || (pct >= 100 ? "#2A4218" : pct >= 60 ? "var(--ink)" : "var(--accent)");
  return (
    <div
      className="ring"
      style={{ ["--p" as string]: pct, ["--c" as string]: c, width: size, height: size }}
    >
      <span className="ring__label">{pct}%</span>
    </div>
  );
}

/* ---------------- Modal ---------------- */
export function Modal({
  open,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? "modal--wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/* ---------------- Tabs ---------------- */
export type TabItem = { value: string; label: string; count?: number };
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: TabItem[];
  value: string;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="tabs">
      {items.map((it) => (
        <button
          key={it.value}
          className={`tab ${value === it.value ? "tab--active" : ""}`}
          onClick={() => onChange?.(it.value)}
        >
          {it.label}
          {it.count != null && <span className="tab__count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Banner ---------------- */
export function Banner({
  variant = "info",
  icon,
  title,
  desc,
  actions,
}: {
  variant?: "info" | "warn" | "error";
  icon?: IconName;
  title: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
}) {
  const fallback: IconName = variant === "error" ? "alert" : variant === "warn" ? "warn" : "info";
  return (
    <div className={`banner banner--${variant}`}>
      <Icon className="banner__icon" name={icon ?? fallback} size={16} />
      <div style={{ minWidth: 0 }}>
        <div className="banner__title">{title}</div>
        {desc && <div className="banner__desc">{desc}</div>}
      </div>
      {actions && <div className="banner__actions">{actions}</div>}
    </div>
  );
}
