import { describe, expect, it } from "vitest";

import { readJsonResponse } from "./http";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("readJsonResponse", () => {
  it("returns parsed JSON on a successful response", async () => {
    const data = await readJsonResponse<{ ok: boolean }>(
      jsonResponse({ ok: true }),
    );

    expect(data).toEqual({ ok: true });
  });

  it("throws the server-provided error message on a failed response", async () => {
    await expect(
      readJsonResponse(jsonResponse({ error: "Item not found." }, 404)),
    ).rejects.toThrow("Item not found.");
  });

  it("fails loudly on a non-JSON body instead of returning undefined", async () => {
    const response = new Response("<html>502</html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });

    await expect(readJsonResponse(response)).rejects.toThrow();
  });
});
