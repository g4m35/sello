import { afterEach, describe, expect, it, vi } from "vitest";

import { runCompFetch } from "@/lib/comps/fetch";
import type { CompSource, NormalizedComp } from "@/lib/comps/source";

function paidSource(
  fetchImpl: () => Promise<NormalizedComp[]> = async () => [],
): CompSource {
  return {
    id: "apify-ebay-sold",
    displayName: "eBay sold (Apify)",
    sold: true,
    resultKind: "sold_comps",
    paid: true,
    isEnabled: () => true,
    fetchComps: vi.fn(fetchImpl),
  };
}

function soldComp(i: number): NormalizedComp {
  return {
    source: "apify-ebay-sold",
    externalId: `c-${i}`,
    title: "Nike Dunk Low Panda",
    priceCents: 12000 + i * 100,
    shippingCents: 0,
    soldDate: "2026-06-10T00:00:00.000Z",
    url: `https://www.ebay.com/itm/${i}`,
    sold: true,
    condition: "used_good",
    brand: "Nike",
    size: "10",
  };
}

const strongItem = {
  id: "item-1",
  productName: "Nike Dunk Low Panda",
  brand: "Nike",
  styleCode: null,
  size: "10",
  category: "sneakers",
  colorway: "Panda",
  condition: "used_good",
  confidence: 0.95,
  recommendedPriceCents: null,
  listingDrafts: [
    { id: "draft-1", title: "Nike Dunk Low Panda", description: "x", recommendedPriceCents: null },
  ],
};

function createPrisma(opts: {
  item?: Record<string, unknown>;
  globalSpentCents?: number;
  userDailyCount?: number;
  userMonthlyCount?: number;
  lastDraftCallAt?: Date | null;
} = {}) {
  const ledger: Array<Record<string, unknown>> = [];
  const item = opts.item ?? strongItem;
  const count = vi
    .fn()
    .mockResolvedValueOnce(opts.userDailyCount ?? 0)
    .mockResolvedValueOnce(opts.userMonthlyCount ?? 0)
    .mockResolvedValue(0);
  return {
    _ledger: ledger,
    inventoryItem: {
      findFirst: vi.fn(async () => item),
      update: vi.fn(async () => ({})),
    },
    listingDraft: { update: vi.fn(async () => ({})) },
    priceComp: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => []),
    },
    compSearchRun: { create: vi.fn(async () => ({ id: "run-1" })) },
    providerCallLedger: {
      aggregate: vi.fn(async () => ({
        _sum: { estimatedCostCents: opts.globalSpentCents ?? 0 },
      })),
      count,
      findFirst: vi.fn(async () =>
        opts.lastDraftCallAt ? { createdAt: opts.lastDraftCallAt } : null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        ledger.push(data);
        return { id: `l-${ledger.length}` };
      }),
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runCompFetch paid-provider budget/quota gates", () => {
  it("skips paid providers (kill switch off by default) and logs the reason", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "");
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma();

    const result = await runCompFetch(prisma as never, "item-1", "user-1", {
      sources: [source],
    });

    expect(source.fetchComps).not.toHaveBeenCalled();
    expect(prisma._ledger).toHaveLength(1);
    expect(prisma._ledger[0]).toMatchObject({
      status: "skipped",
      skippedReason: "paid_providers_disabled",
      estimatedCostCents: 0,
      provider: "apify-ebay-sold",
      userId: "user-1",
    });
    expect(result.status).toBe("no_comps_found");
  });

  it("runs the paid provider and records a succeeded ledger row within limits", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    const source = paidSource(async () => [soldComp(1), soldComp(2), soldComp(3)]);
    const prisma = createPrisma();

    await runCompFetch(prisma as never, "item-1", "user-1", { sources: [source] });

    expect(source.fetchComps).toHaveBeenCalledTimes(1);
    const succeeded = prisma._ledger.find((r) => r.status === "succeeded");
    expect(succeeded).toMatchObject({
      provider: "apify-ebay-sold",
      status: "succeeded",
      fetchedCount: 3,
    });
    expect(succeeded?.estimatedCostCents).toBeGreaterThan(0);
    expect(succeeded?.queryHash).toBeTruthy();
  });

  it("skips when the global daily budget would be exceeded", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    vi.stubEnv("COMPS_APIFY_DAILY_BUDGET_CENTS", "35");
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma({ globalSpentCents: 20 });

    await runCompFetch(prisma as never, "item-1", "user-1", { sources: [source] });

    expect(source.fetchComps).not.toHaveBeenCalled();
    expect(prisma._ledger[0]).toMatchObject({
      status: "skipped",
      skippedReason: "global_budget_exceeded",
    });
  });

  it("skips when the per-user daily quota is reached", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    vi.stubEnv("COMPS_USER_DAILY_PROVIDER_CALL_LIMIT", "2");
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma({ userDailyCount: 2 });

    await runCompFetch(prisma as never, "item-1", "user-1", { sources: [source] });

    expect(source.fetchComps).not.toHaveBeenCalled();
    expect(prisma._ledger[0]).toMatchObject({
      status: "skipped",
      skippedReason: "user_daily_quota_exceeded",
    });
  });

  it("skips when the per-user monthly quota is reached", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    vi.stubEnv("COMPS_USER_MONTHLY_PROVIDER_CALL_LIMIT", "5");
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma({ userDailyCount: 0, userMonthlyCount: 5 });

    await runCompFetch(prisma as never, "item-1", "user-1", { sources: [source] });

    expect(source.fetchComps).not.toHaveBeenCalled();
    expect(prisma._ledger[0]).toMatchObject({
      status: "skipped",
      skippedReason: "user_monthly_quota_exceeded",
    });
  });

  it("skips while the per-draft paid cooldown is active", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    vi.stubEnv("COMPS_DRAFT_PROVIDER_COOLDOWN_SECONDS", "600");
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma({ lastDraftCallAt: new Date(Date.now() - 60_000) });

    await runCompFetch(prisma as never, "item-1", "user-1", { sources: [source] });

    expect(source.fetchComps).not.toHaveBeenCalled();
    expect(prisma._ledger[0]).toMatchObject({
      status: "skipped",
      skippedReason: "draft_cooldown_active",
    });
  });

  it("records a provider failure without leaking secrets", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    const source = paidSource(async () => {
      throw new Error("apify run failed for token secret-apify-token-123");
    });
    const prisma = createPrisma();

    await runCompFetch(prisma as never, "item-1", "user-1", { sources: [source] });

    const failed = prisma._ledger.find((r) => r.status === "failed");
    expect(failed).toMatchObject({
      provider: "apify-ebay-sold",
      status: "failed",
      skippedReason: "provider_error",
    });
    // The ledger row never stores the raw error text / token.
    expect(JSON.stringify(prisma._ledger)).not.toContain("secret-apify-token");
  });

  it("skips paid calls for weak-identity items under auto discovery", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    vi.stubEnv("COMPS_AUTO_DISCOVERY_ENABLED", "true");
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma({
      item: { ...strongItem, brand: "unknown", confidence: 0.2 },
    });

    const result = await runCompFetch(prisma as never, "item-1", "user-1", {
      sources: [source],
    });

    expect(source.fetchComps).not.toHaveBeenCalled();
    expect(result.status).toBe("skipped_weak_identity");
    expect(prisma._ledger[0]).toMatchObject({
      status: "skipped",
      skippedReason: "weak_identity",
    });
  });

  it("still processes free sources when paid providers are disabled", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "");
    const freeSource: CompSource = {
      id: "ebay-browse",
      displayName: "eBay active",
      sold: false,
      resultKind: "active_listings",
      isEnabled: () => true,
      fetchComps: vi.fn(async () => [{ ...soldComp(1), source: "ebay-browse", sold: false }]),
    };
    const paid = paidSource(async () => [soldComp(2)]);
    const prisma = createPrisma();

    await runCompFetch(prisma as never, "item-1", "user-1", {
      sources: [freeSource, paid],
    });

    expect(freeSource.fetchComps).toHaveBeenCalledTimes(1);
    expect(paid.fetchComps).not.toHaveBeenCalled();
    expect(prisma.priceComp.createMany).toHaveBeenCalled();
  });
});
