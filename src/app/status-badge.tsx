import type { InventoryStatus } from "@/generated/prisma/client";
import {
  describeState,
  toLifecycleState,
  type LifecycleTone,
} from "@/lib/lifecycle/item-status";

const toneStyles: Record<LifecycleTone, string> = {
  neutral: "border-neutral-300 bg-neutral-100 text-neutral-700",
  info: "border-sky-300 bg-sky-50 text-sky-900",
  positive: "border-emerald-300 bg-emerald-50 text-emerald-900",
  warn: "border-amber-300 bg-amber-50 text-amber-900",
  danger: "border-red-300 bg-red-50 text-red-800",
};

export default function StatusBadge({
  status,
}: {
  status: InventoryStatus;
}) {
  const { label, tone } = describeState(toLifecycleState(status));

  return (
    <span
      className={`inline-flex items-center border px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${toneStyles[tone]}`}
    >
      {label}
    </span>
  );
}
