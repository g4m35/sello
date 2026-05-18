import { describe, expect, it } from "vitest";

import { POST } from "./route";
import { PATCH } from "./[draftId]/route";

describe("listing draft API auth boundaries", () => {
  it("rejects draft generation when the seller is not signed in", async () => {
    const response = await POST(new Request("http://localhost/api/listings/draft", { method: "POST" }));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });

  it("rejects draft updates when the seller is not signed in", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/listings/draft/draft-id", {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ draftId: "draft-id" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });
});
