import { describe, expect, it } from "vitest";

import { DELETE, PATCH } from "./route";

const params = Promise.resolve({ compId: "11111111-1111-1111-1111-111111111111" });

describe("price comp [compId] API auth boundaries", () => {
  it("rejects updating a comp when the seller is not signed in", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/listings/comps/abc", {
        method: "PATCH",
        body: JSON.stringify({ usedInPricing: false }),
      }),
      { params },
    );
    const payload = await response.json();
    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });

  it("rejects deleting a comp when the seller is not signed in", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/listings/comps/abc", { method: "DELETE" }),
      { params },
    );
    const payload = await response.json();
    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });
});
