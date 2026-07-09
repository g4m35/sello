import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptStockXToken } from "./token-crypto";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    marketplaceConnection: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  }),
}));

vi.mock("./oauth", () => ({
  refreshStockXAccessToken: (...args: unknown[]) => mocks.refresh(...args),
}));

import { loadStockXConnectionSession } from "./session";
import { StockXIntegrationError, stockxErrorCodes } from "./errors";

const key = "a".repeat(64);
const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://sello.wtf/api/marketplaces/stockx/callback",
  apiBaseUrl: "https://api.stockx.com",
  authBaseUrl: "https://accounts.stockx.com",
  apiKey: "api-key",
  scopes: ["offline_access"],
  tokenEncryptionKey: key,
};

describe("loadStockXConnectionSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws notConnected when no marketplace connection exists", async () => {
    mocks.findUnique.mockResolvedValue(null);
    await expect(
      loadStockXConnectionSession(
        { marketplaceConnection: { findUnique: mocks.findUnique, update: mocks.update } } as never,
        "acc-1",
        config,
      ),
    ).rejects.toMatchObject({ code: stockxErrorCodes.notConnected });
  });

  it("returns the decrypted access token when it is still fresh", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "conn-1",
      accountId: "acc-1",
      externalUserId: "stockx|u1",
      accessTokenEnc: encryptStockXToken("access-token", key),
      refreshTokenEnc: encryptStockXToken("refresh-token", key),
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const session = await loadStockXConnectionSession(
      { marketplaceConnection: { findUnique: mocks.findUnique, update: mocks.update } } as never,
      "acc-1",
      config,
    );

    expect(session.accessToken).toBe("access-token");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refreshes and persists tokens when the access token is near expiry", async () => {
    const now = Date.now();
    mocks.findUnique.mockResolvedValue({
      id: "conn-1",
      accountId: "acc-1",
      externalUserId: "stockx|u1",
      accessTokenEnc: encryptStockXToken("old-access", key),
      refreshTokenEnc: encryptStockXToken("refresh-token", key),
      accessTokenExpiresAt: new Date(now + 30_000),
    });
    mocks.refresh.mockResolvedValue({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
    });

    const session = await loadStockXConnectionSession(
      { marketplaceConnection: { findUnique: mocks.findUnique, update: mocks.update } } as never,
      "acc-1",
      config,
      { now },
    );

    expect(session.accessToken).toBe("new-access");
    expect(mocks.refresh).toHaveBeenCalledWith(config, "refresh-token", expect.any(Function));
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conn-1" },
        data: expect.objectContaining({
          accessTokenExpiresAt: new Date(now + 3600 * 1000),
        }),
      }),
    );
  });

  it("surfaces typed StockXIntegrationError from refresh failures", async () => {
    const now = Date.now();
    mocks.findUnique.mockResolvedValue({
      id: "conn-1",
      accountId: "acc-1",
      externalUserId: "stockx|u1",
      accessTokenEnc: encryptStockXToken("old-access", key),
      refreshTokenEnc: encryptStockXToken("refresh-token", key),
      accessTokenExpiresAt: new Date(now + 30_000),
    });
    mocks.refresh.mockRejectedValue(
      new StockXIntegrationError(
        stockxErrorCodes.tokenRefreshFailed,
        "StockX token request failed.",
        502,
      ),
    );

    await expect(
      loadStockXConnectionSession(
        { marketplaceConnection: { findUnique: mocks.findUnique, update: mocks.update } } as never,
        "acc-1",
        config,
        { now },
      ),
    ).rejects.toMatchObject({ code: stockxErrorCodes.tokenRefreshFailed });
  });
});
