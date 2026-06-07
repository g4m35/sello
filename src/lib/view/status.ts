import type {
  InventoryStatus,
  MarketplaceListingStatus,
  PublishAttemptStatus,
} from "@/generated/prisma/client";
import { toLifecycleState, type ItemLifecycleState } from "@/lib/lifecycle/item-status";
import type { DesignStatus } from "@/lib/view/types";

// Lifecycle state -> design badge variant.
const STATE_TO_DESIGN: Record<ItemLifecycleState, DesignStatus> = {
  draft: "draft",
  ready: "ready",
  active: "published",
  sold: "published",
  delisted: "draft",
  error: "failed",
};

export function designStatusFromInventory(status: InventoryStatus): DesignStatus {
  return STATE_TO_DESIGN[toLifecycleState(status)];
}

// Per-channel listing status -> design dot/badge variant.
const LISTING_TO_DESIGN: Record<MarketplaceListingStatus, DesignStatus> = {
  NOT_LISTED: "draft",
  QUEUED: "publishing",
  LISTING: "publishing",
  LISTED: "published",
  SOLD: "published",
  DELISTING: "publishing",
  DELISTED: "draft",
  FAILED: "failed",
};

export function designStatusFromListing(status: MarketplaceListingStatus): DesignStatus {
  return LISTING_TO_DESIGN[status];
}

// Publish attempt status -> design variant. NOT_IMPLEMENTED surfaces honestly
// as "noimpl" so the UI never presents publishing as functional.
const ATTEMPT_TO_DESIGN: Record<PublishAttemptStatus, DesignStatus> = {
  NOT_IMPLEMENTED: "noimpl",
  QUEUED: "publishing",
  RUNNING: "publishing",
  SUCCEEDED: "published",
  FAILED: "failed",
};

export function designStatusFromAttempt(status: PublishAttemptStatus): DesignStatus {
  return ATTEMPT_TO_DESIGN[status];
}

export const DESIGN_STATUS_LABEL: Record<DesignStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  publishing: "Publishing",
  published: "Live",
  failed: "Failed",
  noimpl: "Not implemented",
};
