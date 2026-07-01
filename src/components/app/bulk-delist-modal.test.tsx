import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BulkDelistPreflightResult } from "@/lib/marketplace/bulk-delist";

import { BulkDelistModal } from "./bulk-delist-modal";

const ALPHA_COPY =
  "Live eBay delisting is currently enabled for selected alpha accounts.";

function u(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

const base = {
  open: true as const,
  onClose: () => undefined,
  batchLimit: 25,
  confirmLive: false,
  onConfirmChange: () => undefined,
  onExecute: () => undefined,
  alphaCopy: ALPHA_COPY,
};

function preflight(over: Partial<BulkDelistPreflightResult> = {}): BulkDelistPreflightResult {
  return {
    liveDelistAllowed: true,
    total: 1,
    eligibleCount: 1,
    notListedCount: 0,
    alreadyEndedCount: 0,
    inFlightCount: 0,
    rejectedCount: 0,
    items: [{ itemId: u(1), status: "eligible" }],
    ...over,
  };
}

describe("BulkDelistModal", () => {
  it("shows the account bulk limit next to the current selection", () => {
    const html = renderToStaticMarkup(
      <BulkDelistModal
        {...base}
        selectionCount={6}
        batchLimit={5}
        liveDelistAllowed
        phase="ready"
        preflight={preflight()}
        execution={null}
      />,
    );
    expect(html).toContain("6 selected");
    expect(html).toContain("Plan limit 5");
  });
});
