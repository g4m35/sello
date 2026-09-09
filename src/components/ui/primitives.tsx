"use client";

import { useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Progress from "@radix-ui/react-progress";

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
    <button type="button" className={cls} disabled={disabled} {...rest}>
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
  label = "Select item",
}: {
  label?: string;
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
      disabled={disabled}
      aria-label={label}
      aria-checked={checked}
      role="checkbox"
    >
      {checked && <Icon name="check" size={11} strokeWidth={2.6} />}
    </button>
  );
}

/* ---------------- Toggle ---------------- */
export function Toggle({ on, onChange, label = "Enable setting" }: { on: boolean; onChange?: (next: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange?.(!on)}
      className={`toggle ${on ? "toggle--on" : ""}`}
      aria-label={label}
      aria-pressed={on}
    >
      <span className="toggle__knob" />
    </button>
  );
}

/* ---------------- Ring ---------------- */
export function Ring({ pct = 50, size = 48, color }: { pct?: number; size?: number; color?: string }) {
  const value = Math.min(100, Math.max(0, pct));
  return (
    <Progress.Root className="ring" value={value} max={100} aria-label="Listing completeness"
      style={{ ["--p" as string]: value, ["--c" as string]: color ?? "var(--positive)", width: size, height: size }}>
      <Progress.Indicator className="sr-only" />
      <span className="ring__label">{value}%</span>
    </Progress.Root>
  );
}

/* ---------------- Modal ---------------- */
export function Modal({ open, onClose, children, wide, title = "Listing action" }: {
  open: boolean; onClose?: () => void; children: ReactNode; wide?: boolean; title?: string;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose?.(); }}>
      <Dialog.Overlay className="modal-backdrop">
        <Dialog.Content className={`modal ${wide ? "modal--wide" : ""}`} aria-describedby={undefined}
          onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
          onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus(); }}
          onEscapeKeyDown={(event) => { if (!onClose) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (!onClose) event.preventDefault(); }}>
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Overlay>
    </Dialog.Root>
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
    <div className="tabs" role="group" aria-label="View options">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          aria-pressed={value === it.value}
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
