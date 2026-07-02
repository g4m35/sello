import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearBillingUsageCache,
  fetchBillingUsage,
  getCachedBillingUsage,
  prefetchBillingUsage,
} from "./usage-snapshot";

const snapshot = {
  plan: "free",
  limits: {
    aiListingsPerMonth: 10,
    autopublishesPerMonth: 10,
    compRefreshesPerMonth: 10,
  },
  usage: { ai_listing: 0, autopublish: 0, comp_refresh: 0 },
  periodEnd: null,
  status: "active",
  cancelAtPeriodEnd: false,
};

describe("billing usage snapshot cache", () => {
  beforeEach(() => {
    clearBillingUsageCache();
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(snapshot)),
    );
  });

  it("reuses a fresh billing usage response", async () => {
    await expect(fetchBillingUsage("token-1")).resolves.toEqual(snapshot);
    await expect(fetchBillingUsage("token-1")).resolves.toEqual(snapshot);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getCachedBillingUsage("token-1")).toEqual(snapshot);
  });

  it("can prefetch without surfacing failures to the sidebar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );

    prefetchBillingUsage("token-1");
    await Promise.resolve();
    await Promise.resolve();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getCachedBillingUsage("token-1")).toBeNull();
  });
});
