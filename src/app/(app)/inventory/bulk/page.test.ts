import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("bulk intake seller UI", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/(app)/inventory/bulk/page.tsx"),
    "utf8",
  );

  it("renders upload, grouping, processing, review, ready, and error states", () => {
    expect(source).toContain("Upload a batch");
    expect(source).toContain("Review photo groups");
    expect(source).toContain("processed");
    expect(source).toContain("Review listing");
    expect(source).toContain("Retry item");
    expect(source).toContain("Bulk intake needs attention");
  });

  it("uses listing language and exposes no marketplace action", () => {
    expect(source).toMatch(/generate each listing independently/i);
    expect(source).not.toMatch(/marketplace-ready draft/i);
    expect(source).not.toMatch(/executeBulkPublish|executeBulkDelist|confirmLivePublish/);
  });

  it("shows durable resumability and item-level progress", () => {
    expect(source).toContain("Resume a batch");
    expect(source).toContain("Continue generation");
    expect(source).toContain("Every item is isolated");
  });
});
