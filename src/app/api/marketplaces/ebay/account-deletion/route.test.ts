import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET, POST } from "./route";

const TOKEN = "test-verification-token-1234567890abcdef";
const ENDPOINT = "https://example.com/api/marketplaces/ebay/account-deletion";

describe("eBay account deletion compliance endpoint", () => {
  beforeEach(() => {
    process.env.EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN = TOKEN;
    process.env.EBAY_MARKETPLACE_DELETION_ENDPOINT = ENDPOINT;
  });

  afterEach(() => {
    delete process.env.EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN;
    delete process.env.EBAY_MARKETPLACE_DELETION_ENDPOINT;
  });

  it("GET returns the correct challengeResponse for a known challenge/token/endpoint", async () => {
    const challengeCode = "abc-123-challenge";
    const expected = createHash("sha256")
      .update(challengeCode)
      .update(TOKEN)
      .update(ENDPOINT)
      .digest("hex");

    const res = await GET(
      new Request(
        `http://localhost/api/marketplaces/ebay/account-deletion?challenge_code=${challengeCode}`,
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toEqual({ challengeResponse: expected });
  });

  it("GET requires no auth header (public endpoint)", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/marketplaces/ebay/account-deletion?challenge_code=x",
        // intentionally no Authorization header
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challengeResponse?: string };
    expect(typeof body.challengeResponse).toBe("string");
  });

  it("GET fails with 400 when challenge_code is missing", async () => {
    const res = await GET(
      new Request("http://localhost/api/marketplaces/ebay/account-deletion"),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Missing challenge_code" });
  });

  it("GET fails with 500 when required env is missing", async () => {
    delete process.env.EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN;
    delete process.env.EBAY_MARKETPLACE_DELETION_ENDPOINT;

    const res = await GET(
      new Request(
        "http://localhost/api/marketplaces/ebay/account-deletion?challenge_code=x",
      ),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  });

  it("POST acknowledges a valid deletion payload with 200 { ok: true }", async () => {
    const res = await POST(
      new Request("http://localhost/api/marketplaces/ebay/account-deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" },
          notification: {
            notificationId: "notif-1",
            data: { userId: "ebay-user-1", username: "seller_1", eiasToken: "eias-1" },
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
});
