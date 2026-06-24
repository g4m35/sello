import { describe, expect, it, vi } from "vitest";

import { mapEtsyListingStatus, syncEtsyListing } from "./sync";

describe("mapEtsyListingStatus", () => {
  it.each([
    ["active", "LISTED"],
    ["sold_out", "SOLD"],
    ["inactive", "DELISTED"],
    ["expired", "DELISTED"],
    ["removed", "DELISTED"],
    ["draft", "NOT_LISTED"],
    ["mystery", "NOT_LISTED"],
    [undefined, "NOT_LISTED"],
  ])("maps %s -> %s", (state, expected) => {
    expect(mapEtsyListingStatus(state as string | undefined)).toBe(expected);
  });
});

describe("syncEtsyListing", () => {
  it("reads the listing and returns the mapped status", async () => {
    const client = {
      getListing: vi.fn(async () => ({ listing_id: 555, state: "sold_out" })),
    };
    const result = await syncEtsyListing({ client, listingId: 555 });
    expect(client.getListing).toHaveBeenCalledWith(555);
    expect(result.status).toBe("SOLD");
    expect(result.state).toBe("sold_out");
  });
});
