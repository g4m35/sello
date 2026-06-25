import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";

import {
  bulkBatchTooLarge,
  connectionLimitReached,
  planFeatureRequired,
  quotaExceeded,
} from "./errors";

describe("billing errors", () => {
  it("quotaExceeded carries a per-metric code and 402", () => {
    const err = quotaExceeded("ai_listing");
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(402);
    expect(err.code).toBe("QUOTA_EXCEEDED_AI_LISTING");
    expect(quotaExceeded("comp_refresh").code).toBe("QUOTA_EXCEEDED_COMP_REFRESH");
    expect(quotaExceeded("autopublish").code).toBe("QUOTA_EXCEEDED_AUTOPUBLISH");
  });

  it("planFeatureRequired is a 403 with a stable code", () => {
    const err = planFeatureRequired();
    expect(err.status).toBe(403);
    expect(err.code).toBe("PLAN_FEATURE_REQUIRED");
  });

  it("connectionLimitReached is a 403 and names the limit", () => {
    const err = connectionLimitReached(3);
    expect(err.status).toBe(403);
    expect(err.code).toBe("CONNECTION_LIMIT_REACHED");
    expect(err.message).toContain("3");
  });

  it("bulkBatchTooLarge is a 400 and names the limit", () => {
    const err = bulkBatchTooLarge(25);
    expect(err.status).toBe(400);
    expect(err.code).toBe("BULK_BATCH_TOO_LARGE");
    expect(err.message).toContain("25");
  });

  it("uses no em dashes in seller-facing copy", () => {
    for (const err of [
      quotaExceeded("ai_listing"),
      planFeatureRequired(),
      connectionLimitReached(1),
      bulkBatchTooLarge(5),
    ]) {
      expect(err.message).not.toContain("—");
    }
  });
});
