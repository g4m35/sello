import { describe, expect, it } from "vitest";

import { GET, POST } from "./route";

describe("price comps API auth boundaries", () => {
  it("rejects loading comps when the seller is not signed in", async () => {
    const response = await GET(
      new Request("http://localhost/api/listings/comps", { method: "GET" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });

  it("rejects adding a comp when the seller is not signed in", async () => {
    const response = await POST(
      new Request("http://localhost/api/listings/comps", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "x", comp: {} }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });
});
