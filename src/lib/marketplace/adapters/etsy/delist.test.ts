import { describe, expect, it, vi } from "vitest";

import { deactivateEtsyListing } from "./delist";

describe("deactivateEtsyListing", () => {
  it("deactivates the listing through the client", async () => {
    const client = {
      deactivateListing: vi.fn(async () => ({ listing_id: 7, state: "inactive" })),
    };
    const result = await deactivateEtsyListing({ client, shopId: 1, listingId: 7 });
    expect(client.deactivateListing).toHaveBeenCalledWith(1, 7);
    expect(result.state).toBe("inactive");
  });

  it("propagates a failure so the caller does not mark the item ended", async () => {
    const client = {
      deactivateListing: vi.fn(async () => {
        throw new Error("etsy deactivate failed");
      }),
    };
    await expect(
      deactivateEtsyListing({ client, shopId: 1, listingId: 7 }),
    ).rejects.toThrow();
  });
});
