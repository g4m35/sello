import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("publish API auth boundaries", () => {
  it("rejects publish attempts when the seller is not signed in", async () => {
    const response = await POST(
      new Request("http://localhost/api/listings/publish", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "x", marketplace: "ebay" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });
});
