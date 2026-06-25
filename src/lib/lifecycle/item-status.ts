import type { InventoryStatus } from "@/generated/prisma/client";

export type ItemLifecycleState =
  | "draft"
  | "ready"
  | "active"
  | "sold"
  | "delisted"
  | "error";

export type LifecycleTone = "neutral" | "info" | "positive" | "warn" | "danger";

export const LIFECYCLE_STATES: readonly ItemLifecycleState[] = [
  "draft",
  "ready",
  "active",
  "sold",
  "delisted",
  "error",
];

// Exhaustive on purpose: a new InventoryStatus enum value is a compile error
// here until it is given a lifecycle meaning, instead of silently misreporting.
const STATUS_TO_STATE: Record<InventoryStatus, ItemLifecycleState> = {
  DRAFTING: "draft",
  DRAFT_READY: "draft",
  AI_FAILED: "error",
  APPROVED: "ready",
  LISTING: "active",
  LISTED: "active",
  SOLD: "sold",
  DELISTING: "delisted",
  DELISTED: "delisted",
  ARCHIVED: "delisted",
};

export function toLifecycleState(status: InventoryStatus): ItemLifecycleState {
  return STATUS_TO_STATE[status];
}

export const ALLOWED_TRANSITIONS: Record<
  ItemLifecycleState,
  readonly ItemLifecycleState[]
> = {
  draft: ["ready", "delisted", "error"],
  ready: ["active", "sold", "delisted", "draft"],
  active: ["sold", "delisted"],
  sold: [],
  delisted: ["draft"],
  error: ["draft"],
};

export function canTransition(
  from: ItemLifecycleState,
  to: ItemLifecycleState,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// Publishing-related actions are only meaningful once the item is ready or
// already live. Nothing here performs real publishing.
export function canPublish(state: ItemLifecycleState): boolean {
  return state === "ready" || state === "active";
}

// Statuses that can never publish: the item is sold or archived. Publish gating
// is otherwise driven by computed field readiness, not by a manual ready/approved
// status, so a complete draft can publish without a separate "mark ready" step.
export const TERMINAL_PUBLISH_STATUSES: readonly InventoryStatus[] = [
  "SOLD",
  "ARCHIVED",
];

const STATE_DESCRIPTIONS: Record<
  ItemLifecycleState,
  { label: string; tone: LifecycleTone }
> = {
  draft: { label: "Draft", tone: "neutral" },
  ready: { label: "Ready", tone: "positive" },
  active: { label: "Active", tone: "info" },
  sold: { label: "Sold", tone: "positive" },
  delisted: { label: "Delisted", tone: "warn" },
  error: { label: "Error", tone: "danger" },
};

export function describeState(state: ItemLifecycleState): {
  label: string;
  tone: LifecycleTone;
} {
  return STATE_DESCRIPTIONS[state];
}
