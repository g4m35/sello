import type { ItemLifecycleState } from "@/lib/lifecycle/item-status";
import type { ItemView } from "./types";

// Shared readiness bucketing so the dashboard "Ready to publish" set and the
// inventory "Ready" tab always agree. Readiness is computed from the listing
// fields (server readiness); there is no separate "mark ready"/approved step. An
// item is publish-ready when its fields pass and it is not already live, sold, or
// archived — so a finished DRAFT is publishable immediately.

function isPreLive(item: ItemView): boolean {
  return item.lifecycleState === "draft" || item.lifecycleState === "ready";
}

export function isPublishReady(item: ItemView): boolean {
  return item.ready && isPreLive(item);
}

export function needsAttention(item: ItemView): boolean {
  if (item.lifecycleState === "error") return true;
  // A legacy item already marked ready that no longer passes computed readiness.
  if (item.lifecycleState === "ready" && !item.ready) return true;
  return false;
}

// The lifecycle bucket the inventory tabs/counts should display an item under. A
// pre-live item that passes computed readiness shows under "ready" (no approve
// step); one that does not stays a draft. A legacy approved-but-not-ready item is
// folded into the "needs attention" (error) tab so it is never miscounted as
// ready and never hidden from view.
export function inventoryDisplayBucket(item: ItemView): ItemLifecycleState {
  if (item.lifecycleState === "draft") return item.ready ? "ready" : "draft";
  if (item.lifecycleState === "ready") return item.ready ? "ready" : "error";
  return item.lifecycleState;
}
