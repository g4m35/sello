import type { ItemLifecycleState } from "@/lib/lifecycle/item-status";
import type { ItemView } from "./types";

// Shared readiness bucketing so the dashboard "Ready to publish" set and the
// inventory "Ready" tab always agree: an item is only publish-ready when its
// lifecycle says ready AND server readiness (size, condition, category, etc.)
// passes. An item that was approved before a field became required (so its
// lifecycle is "ready" but readiness now fails) is surfaced as needs-attention,
// never as ready, in both surfaces.

export function isPublishReady(item: ItemView): boolean {
  return item.lifecycleState === "ready" && item.ready;
}

export function needsAttention(item: ItemView): boolean {
  if (item.lifecycleState === "error") return true;
  if (item.lifecycleState === "ready" && !item.ready) return true;
  return false;
}

// The lifecycle bucket the inventory tabs/counts should display an item under.
// Folds an approved-but-not-ready item into the "needs attention" (error) tab
// so it is never miscounted as ready and never hidden from view.
export function inventoryDisplayBucket(item: ItemView): ItemLifecycleState {
  if (item.lifecycleState === "ready" && !item.ready) return "error";
  return item.lifecycleState;
}
