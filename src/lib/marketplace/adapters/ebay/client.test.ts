import { describe, expect, it, vi } from "vitest";

import {
  EbaySandboxClient,
  getUsableEbayAccessToken,
  type EbayTokenPrismaLike,
} from "./client";
import { decryptEbayToken, encryptEbayToken } from "./token-crypto";

const key =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const config = {
  environment: "sandbox" as const,
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUriName: "redirect-name",
  marketplaceId: "EBAY_US" as const,
  tokenEncryptionKey: key,
};

describe("eBay sandbox client", () => {
  it("normalizes API failures without exposing bearer tokens", async () => {
    const client = new EbaySandboxClient("secret-access-token", "EBAY_US", async () =>
      new Response(JSON.stringify({ errors: [{ errorId: 1 }] }), { status: 500 }),
    );

    await expect(client.listPaymentPolicies()).rejects.toMatchObject({
      code: "EBAY_API_FAILED",
      status: 502,
    });
    await expect(client.listPaymentPolicies()).rejects.not.toThrow(
      "secret-access-token",
    );
  });

  it("refreshes expired access tokens and stores encrypted replacement tokens", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma: EbayTokenPrismaLike = {
      marketplaceConnection: { update },
    };

    const accessToken = await getUsableEbayAccessToken(
      prisma,
      {
        id: "connection-1",
        accessTokenEnc: encryptEbayToken("expired-access-token", key),
        refreshTokenEnc: encryptEbayToken("refresh-token", key),
        accessTokenExpiresAt: new Date(Date.now() - 60_000),
      },
      config,
      async () =>
        new Response(
          JSON.stringify({
            access_token: "fresh-access-token",
            refresh_token: "fresh-refresh-token",
            expires_in: 7200,
            refresh_token_expires_in: 86400,
            scope: "scope-a scope-b",
          }),
          { status: 200 },
        ),
    );

    expect(accessToken).toBe("fresh-access-token");
    const data = update.mock.calls[0][0].data;
    expect(JSON.stringify(data)).not.toContain("fresh-access-token");
    expect(decryptEbayToken(data.accessTokenEnc, key)).toBe("fresh-access-token");
    expect(decryptEbayToken(data.refreshTokenEnc, key)).toBe(
      "fresh-refresh-token",
    );
  });
});
