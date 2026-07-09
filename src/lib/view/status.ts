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
  delisted: "delisted",
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
  DELISTED: "delisted",
  FAILED: "failed",
  // Cross-marketplace safety / audit statuses (additive). ENDED mirrors a
  // delisted channel; in-flight/unknown audit states read as publishing; states
  // that need seller attention surface as failed so the UI never hides them.
  ENDED: "delisted",
  UNKNOWN: "publishing",
  NEEDS_REVIEW: "failed",
  SUBMITTED_FOR_AUDIT: "publishing",
  REJECTED: "failed",
};

export function designStatusFromListing(status: MarketplaceListingStatus): DesignStatus {
  return LISTING_TO_DESIGN[status];
}

export type AttemptDesignContext = {
  code?: string | null;
  listingStatus?: MarketplaceListingStatus | string | null;
  externalOfferId?: string | null;
  externalListingId?: string | null;
};

// Publish attempt status -> design variant. NOT_IMPLEMENTED surfaces honestly
// as "noimpl" so the UI never presents publishing as functional. A successful
// operational attempt is only "published" when it is a real publish success with
// stored marketplace identifiers.
const ATTEMPT_TO_DESIGN: Record<PublishAttemptStatus, DesignStatus> = {
  NOT_IMPLEMENTED: "noimpl",
  QUEUED: "publishing",
  RUNNING: "publishing",
  SUCCEEDED: "ready",
  FAILED: "failed",
};

export function designStatusFromAttempt(
  status: PublishAttemptStatus,
  context: AttemptDesignContext = {},
): DesignStatus {
  if (status !== "SUCCEEDED") return ATTEMPT_TO_DESIGN[status];
  if (context.code?.startsWith("EBAY_DELIST") || context.listingStatus === "DELISTED") {
    return "delisted";
  }
  if (
    context.code?.startsWith("EBAY_PUBLISH") &&
    (context.listingStatus === "LISTED" || context.listingStatus === "SOLD") &&
    context.externalOfferId &&
    context.externalListingId
  ) {
    return "published";
  }
  return ATTEMPT_TO_DESIGN[status];
}

export const DESIGN_STATUS_LABEL: Record<DesignStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  publishing: "Publishing",
  published: "Published",
  delisted: "Delisted",
  failed: "Failed",
  noimpl: "Not implemented",
};
