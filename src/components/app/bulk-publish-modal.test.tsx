import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  BulkExecutionResult,
  BulkPreflightResult,
} from "@/lib/marketplace/bulk-publish";

import { BulkPublishModal } from "./bulk-publish-modal";

const LIVE_CONFIRM = "I understand this will create live eBay listings.";
const ALPHA_COPY =
  "Live eBay publishing is currently enabled for selected alpha accounts.";

function u(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

const base = {
  open: true as const,
  onClose: () => undefined,
  confirmLive: false,
  onConfirmChange: () => undefined,
  onExecute: () => undefined,
  onRetry: () => undefined,
  alphaCopy: ALPHA_COPY,
};

function preflight(over: Partial<BulkPreflightResult> = {}): BulkPreflightResult {
  return {
    livePublishAllowed: true,
    total: 25,
    readyCount: 20,
    needsDetailsCount: 3,
    skippedCount: 2,
    rejectedCount: 0,
    items: [],
    ...over,
  };
}

describe("BulkPublishModal", () => {
  it("shows ready/blocked/skipped counts for a large selection", () => {
    const html = renderToStaticMarkup(
      <BulkPublishModal
        {...base}
        selectionCount={25}
        livePublishAllowed
        phase="ready"
        preflight={preflight()}
        execution={null}
      />,
    );
    expect(html).toContain("Ready 20");
    expect(html).toContain("Needs details 3");
    expect(html).toContain("Already listed 2");
  });

  it("lists per-item missing reasons", () => {
    const html = renderToStaticMarkup(
      <BulkPublishModal
        {...base}
        selectionCount={1}
        livePublishAllowed
        phase="ready"
        preflight={preflight({
          total: 1,
          readyCount: 0,
          needsDetailsCount: 1,
          skippedCount: 0,
          items: [{ itemId: u(2), status: "needs_details", missing: ["Title", "Price"] }],
        })}
        execution={null}
      />,
    );
    expect(html).toContain("Title");
    expect(html).toContain("Price");
  });

  it("renders an alpha-only preview without any live confirmation action", () => {
    const html = renderToStaticMarkup(
      <BulkPublishModal
        {...base}
        selectionCount={25}
        livePublishAllowed={false}
        phase="ready"
        preflight={preflight({ livePublishAllowed: false })}
        execution={null}
      />,
    );
    expect(html).toContain(ALPHA_COPY);
    expect(html).not.toContain(LIVE_CONFIRM);
    expect(html).not.toContain("Publish");
  });

  it("shows the live confirmation checkbox text for allowlisted accounts", () => {
    const html = renderToStaticMarkup(
      <BulkPublishModal
        {...base}
        selectionCount={25}
        livePublishAllowed
        phase="ready"
        preflight={preflight()}
        execution={null}
      />,
    );
    expect(html).toContain(LIVE_CONFIRM);
  });

  it("renders independent published/failed/skipped/needs-details results", () => {
    const execution: BulkExecutionResult = {
      bulkRunId: u(999),
      total: 4,
      publishedCount: 1,
      skippedCount: 1,
      failedCount: 1,
      needsDetailsCount: 1,
      items: [
        { itemId: u(1), status: "published", message: "Listed on eBay." },
        { itemId: u(2), status: "skipped", message: "This item is already listed on eBay." },
        { itemId: u(3), status: "failed", message: "Something went wrong publishing this item." },
        {
          itemId: u(4),
          status: "needs_details",
          message: "This listing needs a few more details before it can go live.",
        },
      ],
    };
    const html = renderToStaticMarkup(
      <BulkPublishModal
        {...base}
        selectionCount={4}
        livePublishAllowed
        phase="result"
        preflight={null}
        execution={execution}
      />,
    );
    expect(html).toContain("Published");
    expect(html).toContain("Skipped");
    expect(html).toContain("Failed");
    expect(html).toContain("Needs details");
    expect(html).toContain("Listed on eBay.");
  });

  it("offers retry only for results marked retrySafe", () => {
    const execution: BulkExecutionResult = {
      bulkRunId: u(999),
      total: 3,
      publishedCount: 1,
      skippedCount: 0,
      failedCount: 2,
      needsDetailsCount: 0,
      items: [
        { itemId: u(1), status: "published", message: "Listed on eBay." },
        { itemId: u(2), status: "failed", message: "Try again.", retrySafe: true },
        { itemId: u(3), status: "failed", message: "This item couldn’t be published." },
      ],
    };
    const html = renderToStaticMarkup(
      <BulkPublishModal
        {...base}
        selectionCount={3}
        livePublishAllowed
        phase="result"
        preflight={null}
        execution={execution}
      />,
    );
    expect((html.match(/Retry/g) ?? []).length).toBe(1);
  });

  it("never renders raw error or provider payload text", () => {
    const execution: BulkExecutionResult = {
      bulkRunId: u(999),
      total: 1,
      publishedCount: 0,
      skippedCount: 0,
      failedCount: 1,
      needsDetailsCount: 0,
      items: [
        { itemId: u(1), status: "failed", message: "Something went wrong publishing this item." },
      ],
    };
    const html = renderToStaticMarkup(
      <BulkPublishModal
        {...base}
        selectionCount={1}
        livePublishAllowed
        phase="result"
        preflight={null}
        execution={execution}
      />,
    );
    expect(html).not.toContain("[object Object]");
    expect(html).not.toContain("undefined");
  });
});
