import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultStockXPublishDeps } from "./publish";
import { defaultStockXDelistDeps } from "./delist";
import { defaultStockXStatusSyncDeps } from "./status-sync";
import { decryptStockXToken, encryptStockXToken } from "./token-crypto";
import type { StockXTokenPrismaLike } from "./session";
import type { StockXConfig } from "./types";

const key = "a".repeat(64);
const config: StockXConfig = {
  clientId: "client", clientSecret: "secret", redirectUri: "https://example.test/callback",
  apiBaseUrl: "https://api.stockx.com", authBaseUrl: "https://accounts.stockx.com",
  apiKey: "api-key", scopes: ["offline_access"], tokenEncryptionKey: key,
};
const actions = [
  { name: "publish", resolve: defaultStockXPublishDeps.resolveAccessToken },
  { name: "delist", resolve: defaultStockXDelistDeps.resolveAccessToken },
  { name: "status sync", resolve: defaultStockXStatusSyncDeps.resolveAccessToken },
];
function connection(expired: boolean) {
  return { id: "connection-1", accountId: "account-1", externalUserId: "seller-1",
    accessTokenEnc: encryptStockXToken("old-access", key),
    refreshTokenEnc: encryptStockXToken("old-refresh", key),
    accessTokenExpiresAt: new Date(Date.now() + (expired ? -1000 : 3600_000)) };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe.each(actions)("StockX $name production token handling", ({ resolve }) => {
  it("refreshes expired credentials, persists rotation encrypted and uses the new token", async () => {
    const fetchMock = vi.fn(async () => Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, token_type: "Bearer" }));
    vi.stubGlobal("fetch", fetchMock);
    const update = vi.fn<StockXTokenPrismaLike["marketplaceConnection"]["update"]>().mockResolvedValue({});
    const token = await resolve(connection(true), config, { marketplaceConnection: { update } });
    expect(token).toBe("new-access");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const mutation = update.mock.calls[0]![0];
    expect(mutation.where).toEqual({ id: "connection-1", accountId: "account-1" });
    expect(decryptStockXToken(mutation.data.accessTokenEnc, key)).toBe("new-access");
    expect(decryptStockXToken(mutation.data.refreshTokenEnc, key)).toBe("new-refresh");
  });

  it("retains a valid refresh token when the provider does not rotate it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ access_token: "new-access", expires_in: 3600, token_type: "Bearer" })));
    const row = connection(true);
    const update = vi.fn<StockXTokenPrismaLike["marketplaceConnection"]["update"]>().mockResolvedValue({});
    await resolve(row, config, { marketplaceConnection: { update } });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ refreshTokenEnc: row.refreshTokenEnc }) }));
  });

  it("uses a fresh token without making a provider request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const update = vi.fn<StockXTokenPrismaLike["marketplaceConnection"]["update"]>().mockResolvedValue({});
    await expect(resolve(connection(false), config, { marketplaceConnection: { update } })).resolves.toBe("old-access");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("fails closed when refresh is rejected without returning the expired token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 401 })));
    const update = vi.fn<StockXTokenPrismaLike["marketplaceConnection"]["update"]>().mockResolvedValue({});
    await expect(resolve(connection(true), config, { marketplaceConnection: { update } })).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });
});
