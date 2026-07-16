import { afterEach, describe, expect, it, vi } from "vitest";

import { assertBulkBatchSize } from "./batch";

describe("assertBulkBatchSize", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows a batch within the plan limit", () => {
    expect(() => assertBulkBatchSize({ plan: "free" }, 5)).not.toThrow();
    expect(() => assertBulkBatchSize({ plan: "pro" }, 25)).not.toThrow();
    expect(() => assertBulkBatchSize({ plan: "kingpin" }, 250)).not.toThrow();
  });

  it("throws BULK_BATCH_TOO_LARGE above the plan limit", () => {
    expect(() => assertBulkBatchSize({ plan: "free" }, 6)).toThrow();
    try {
      assertBulkBatchSize({ plan: "pro" }, 26);
      throw new Error("expected throw");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("BULK_BATCH_TOO_LARGE");
    }
  });

  it("never batch-caps allow-listed admins", () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    expect(() =>
      assertBulkBatchSize({ plan: "free" }, 10_000, { email: "owner@example.com" }),
    ).not.toThrow();
  });
});
