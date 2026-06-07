import { describe, expect, it } from "vitest";

import {
  getPublishStatusFromApiResult,
  isPublishApiResponse,
} from "./seller-workbench";

describe("seller workbench publish status copy", () => {
  it("renders eBay disabled publish with clear sandbox-disabled copy and code", () => {
    const payload = {
      status: "not_enabled",
      code: "EBAY_PUBLISH_NOT_ENABLED",
      marketplace: "ebay",
      environment: "sandbox",
      message: "server flag off",
      marketplaceListingId: "listing-1",
      publishAttemptId: "attempt-1",
    } as const;

    expect(isPublishApiResponse(payload)).toBe(true);
    expect(getPublishStatusFromApiResult("ebay", payload)).toMatchObject({
      kind: "not_implemented",
      code: "EBAY_PUBLISH_NOT_ENABLED",
      message: "Sandbox publish is disabled by server flag. No eBay API calls were made.",
      publishAttemptId: "attempt-1",
    });
  });

  it("keeps non-eBay NOT_IMPLEMENTED copy and code", () => {
    const payload = {
      code: "NOT_IMPLEMENTED",
      marketplace: "grailed",
      reason: "Grailed publishing is not implemented.",
      marketplaceListingId: "listing-1",
      publishAttemptId: "attempt-1",
    } as const;

    expect(isPublishApiResponse(payload)).toBe(true);
    expect(getPublishStatusFromApiResult("grailed", payload)).toMatchObject({
      kind: "not_implemented",
      code: "NOT_IMPLEMENTED",
      message: "Grailed publishing is not implemented.",
    });
  });
});
