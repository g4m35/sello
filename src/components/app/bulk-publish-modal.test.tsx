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
  batchLimit: 25,
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

  it("shows the account bulk limit next to the current selection", () => {
    const html = renderToStaticMarkup(
      <BulkPublishModal
        {...base}
        selectionCount={6}
        batchLimit={5}
        livePublishAllowed
        phase="ready"
        preflight={preflight({ total: 5 })}
        execution={null}
      />,
    );
    expect(html).toContain("6 selected");
    expect(html).toContain("Plan limit 5");
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

  it("renders StockX-specific readiness and confirmation copy", () => {
    const html = renderToStaticMarkup(
      <BulkPublishModal
        {...base}
        marketplace="stockx"
        selectionCount={2}
        livePublishAllowed
        phase="ready"
        preflight={preflight({
          total: 2,
          readyCount: 1,
          needsDetailsCount: 1,
          skippedCount: 0,
          items: [
            { itemId: u(1), status: "ready" },
            {
              itemId: u(2),
              status: "needs_details",
              missing: ["Exact StockX product", "Exact StockX size/variant"],
            },
          ],
        })}
        execution={null}
      />,
    );

    expect(html).toContain("Publish selected to StockX");
    expect(html).toContain("Exact product and size ready");
    expect(html).toContain("Exact StockX product");
    expect(html).toContain("I understand this will create live StockX listings.");
  });

  it("renders StockX submitted result copy safely", () => {
    const execution: BulkExecutionResult = {
      bulkRunId: u(999),
      total: 1,
      publishedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      needsDetailsCount: 0,
      items: [
        {
          itemId: u(1),
          status: "published",
          message: "Submitted to StockX. Sello is checking status.",
        },
      ],
    };
    const html = renderToStaticMarkup(
      <BulkPublishModal
        {...base}
        marketplace="stockx"
        selectionCount={1}
        livePublishAllowed
        phase="result"
        preflight={null}
        execution={execution}
      />,
    );

    expect(html).toContain("Submitted to StockX");
    expect(html).not.toContain("[object Object]");
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
