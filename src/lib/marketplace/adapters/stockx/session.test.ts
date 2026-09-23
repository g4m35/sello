import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptStockXToken, encryptStockXToken } from "./token-crypto";

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

import { getUsableStockXAccessToken, loadStockXConnectionSession, type StockXTokenPrismaLike } from "./session";
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
        where: expect.objectContaining({ id: "conn-1", accountId: "acc-1", accessTokenEnc: expect.any(String), refreshTokenEnc: expect.any(String) }),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function refreshRaceFixture() {
  const stored = {
    id: "connection-race", accountId: "account-race",
    accessTokenEnc: encryptStockXToken("original-access", key),
    refreshTokenEnc: encryptStockXToken("original-refresh", key),
    accessTokenExpiresAt: new Date(0),
  };
  const update = vi.fn<StockXTokenPrismaLike["marketplaceConnection"]["update"]>(async ({ where, data }) => {
    if (where.id !== stored.id || where.accountId !== stored.accountId || where.accessTokenEnc !== stored.accessTokenEnc || where.refreshTokenEnc !== stored.refreshTokenEnc) {
      throw Object.assign(new Error("Connection version changed"), { code: "P2025" });
    }
    Object.assign(stored, data);
    return stored;
  });
  return { stored, db: { marketplaceConnection: { update } } };
}

describe("StockX refresh persistence races", () => {
  it("rejects a delayed refresh after reconnect without overwriting or returning the former identity", async () => {
    const f = refreshRaceFixture();
    const refresh = deferred<{ access_token: string; refresh_token: string; expires_in: number }>();
    mocks.refresh.mockReturnValueOnce(refresh.promise);
    const pending = getUsableStockXAccessToken(f.db, { ...f.stored }, config);
    const rejected = expect(pending).rejects.toMatchObject({ code: stockxErrorCodes.tokenRefreshFailed, status: 409 });
    f.stored.accessTokenEnc = encryptStockXToken("reconnected-access", key);
    f.stored.refreshTokenEnc = encryptStockXToken("reconnected-refresh", key);
    refresh.resolve({ access_token: "stale-access", refresh_token: "stale-refresh", expires_in: 3600 });
    await rejected;
    expect(decryptStockXToken(f.stored.accessTokenEnc, key)).toBe("reconnected-access");
    expect(decryptStockXToken(f.stored.refreshTokenEnc, key)).toBe("reconnected-refresh");
  });

  it("lets only one competing refresh persist and rejects the losing rotated token", async () => {
    const f = refreshRaceFixture();
    const firstRefresh = deferred<{ access_token: string; refresh_token: string; expires_in: number }>();
    const secondRefresh = deferred<{ access_token: string; refresh_token: string; expires_in: number }>();
    mocks.refresh.mockReturnValueOnce(firstRefresh.promise).mockReturnValueOnce(secondRefresh.promise);
    const snapshot = { ...f.stored };
    const first = getUsableStockXAccessToken(f.db, snapshot, config);
    const second = getUsableStockXAccessToken(f.db, snapshot, config);
    const rejected = expect(second).rejects.toMatchObject({ code: stockxErrorCodes.tokenRefreshFailed, status: 409 });
    firstRefresh.resolve({ access_token: "winner-access", refresh_token: "winner-refresh", expires_in: 3600 });
    await expect(first).resolves.toBe("winner-access");
    secondRefresh.resolve({ access_token: "loser-access", refresh_token: "loser-refresh", expires_in: 3600 });
    await rejected;
    expect(decryptStockXToken(f.stored.accessTokenEnc, key)).toBe("winner-access");
    expect(decryptStockXToken(f.stored.refreshTokenEnc, key)).toBe("winner-refresh");
  });
});
