import { describe, expect, it } from "vitest";

import { designStatusFromAttempt, designStatusFromListing, DESIGN_STATUS_LABEL } from "./status";

describe("publish operation design status", () => {
  it("does not label disabled publishing attempts as live or published", () => {
    const status = designStatusFromAttempt("SUCCEEDED", {
      code: "EBAY_PUBLISH_NOT_ENABLED",
      listingStatus: "NOT_LISTED",
      externalOfferId: null,
      externalListingId: null,
    });

    expect(status).toBe("ready");
    expect(DESIGN_STATUS_LABEL[status]).not.toBe("Live");
  });

  it("does not label orphan cleanup success as published", () => {
    const status = designStatusFromAttempt("SUCCEEDED", {
      code: "EBAY_ORPHAN_CLEANUP_SUCCEEDED",
      listingStatus: "FAILED",
      externalOfferId: "offer-1",
      externalListingId: null,
    });

    expect(status).toBe("ready");
  });

  it("labels pending or running attempts as publishing", () => {
    expect(designStatusFromAttempt("QUEUED")).toBe("publishing");
    expect(designStatusFromAttempt("RUNNING")).toBe("publishing");
  });

  it("labels failed attempts as failed", () => {
    expect(designStatusFromAttempt("FAILED")).toBe("failed");
  });

  it("labels a successful publish as published only with stored marketplace identifiers", () => {
    expect(
      designStatusFromAttempt("SUCCEEDED", {
        code: "EBAY_PUBLISH_SUCCEEDED",
        listingStatus: "LISTED",
        externalOfferId: "offer-1",
        externalListingId: "ebay-listing-1",
      }),
    ).toBe("published");

    expect(
      designStatusFromAttempt("SUCCEEDED", {
        code: "EBAY_PUBLISH_SUCCEEDED",
        listingStatus: "LISTED",
        externalOfferId: "offer-1",
        externalListingId: null,
      }),
    ).toBe("ready");
  });

  it("labels delisted marketplace listings distinctly", () => {
    expect(designStatusFromListing("DELISTED")).toBe("delisted");
    expect(
      designStatusFromAttempt("SUCCEEDED", {
        code: "EBAY_DELIST_SUCCEEDED",
        listingStatus: "DELISTED",
        externalOfferId: "offer-1",
        externalListingId: "ebay-listing-1",
      }),
    ).toBe("delisted");
    expect(DESIGN_STATUS_LABEL.delisted).toBe("Delisted");
  });
});
