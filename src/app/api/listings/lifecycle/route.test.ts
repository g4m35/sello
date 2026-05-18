import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("item lifecycle API auth boundaries", () => {
  it("rejects lifecycle changes when the seller is not signed in", async () => {
    const response = await POST(
      new Request("http://localhost/api/listings/lifecycle", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "x", action: "mark_sold" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });
});
