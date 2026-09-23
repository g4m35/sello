import { describe, expect, it } from "vitest";
import { bulkJobId } from "./job-id";

describe("bulk JobLog UUIDs", () => {
  it("produces a stable UUID with version 8 and RFC variant bits", () => {
    const id = bulkJobId("identify", "20000000-0000-4000-8000-000000000099", 2);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(bulkJobId("identify", "20000000-0000-4000-8000-000000000099", 2)).toBe(id);
  });
  it("separates kind, item, and attempt while preserving deduplication", () => {
    expect(new Set([
      bulkJobId("identify", "item-1", 0), bulkJobId("identify", "item-1", 1),
      bulkJobId("identify", "item-2", 0), bulkJobId("prepare", "item-1"),
    ]).size).toBe(4);
    expect(bulkJobId("prepare", "item-1")).toBe(bulkJobId("prepare", "item-1", 0));
  });
});
