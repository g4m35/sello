import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("jobs API auth boundaries", () => {
  it("rejects job visibility when the seller is not signed in", async () => {
    const response = await GET(
      new Request("http://localhost/api/jobs", { method: "GET" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });
});
