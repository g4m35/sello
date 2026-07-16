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
  accountId: "acc-1",
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
  /** Simulate real Postgres: $queryRaw* cannot deserialize pg_advisory_xact_lock's void. */
  queryRawThrows?: Error;
  /** Simulate a DB failure while acquiring the advisory lock / reserving. */
  executeRawThrows?: Error;
} = {}) {
  const ledger: Array<Record<string, unknown>> = [];
  const runs: Array<Record<string, unknown>> = [];
  const item = opts.item ?? strongItem;
  let transactionTail = Promise.resolve();
  let nextLedgerId = 1;
  let countCalls = 0;
  const costingStatuses = new Set(["attempted", "succeeded", "failed"]);
  const providerCallLedger = {
    aggregate: vi.fn(async ({ where }: { where: { createdAt: { gte: Date } } }) => ({
      _sum: {
        estimatedCostCents:
          (opts.globalSpentCents ?? 0) +
          ledger
            .filter(
              (row) =>
                costingStatuses.has(String(row.status)) &&
                (row.createdAt as Date) >= where.createdAt.gte,
            )
            .reduce((sum, row) => sum + Number(row.estimatedCostCents), 0),
      },
    })),
    count: vi.fn(
      async ({ where }: { where: { userId?: string; accountId?: string; createdAt: { gte: Date } } }) => {
        const now = new Date();
        const dayStart = Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          0,
          0,
          0,
          0,
        );
        const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
        const countCall = countCalls++;
        const isDailyWindow =
          dayStart === monthStart
            ? countCall % 2 === 0
            : where.createdAt.gte.getTime() === dayStart;
        const initialCount = isDailyWindow
          ? (opts.userDailyCount ?? 0)
          : (opts.userMonthlyCount ?? 0);
        return (
          initialCount +
          ledger.filter(
            (row) =>
              (where.accountId ? row.accountId === where.accountId : row.userId === where.userId) &&
              costingStatuses.has(String(row.status)) &&
              (row.createdAt as Date) >= where.createdAt.gte,
          ).length
        );
      },
    ),
    findFirst: vi.fn(
      async ({
        where,
      }: {
        where: {
          userId?: string;
          accountId?: string;
          draftId?: string;
          provider?: string;
          idempotencyKey?: string;
        };
      }) => {
        if (where.accountId && where.idempotencyKey) {
          const duplicate = [...ledger].reverse().find(
            (entry) => entry.accountId === where.accountId &&
              entry.idempotencyKey === where.idempotencyKey,
          );
          return duplicate ? { createdAt: duplicate.createdAt as Date } : null;
        }
        if (opts.lastDraftCallAt) return { createdAt: opts.lastDraftCallAt };
        const row = [...ledger]
          .reverse()
          .find(
            (entry) =>
              (where.accountId
                ? entry.accountId === where.accountId
                : entry.userId === where.userId) &&
              entry.draftId === where.draftId &&
              entry.provider === where.provider &&
              costingStatuses.has(String(entry.status)),
          );
        return row ? { createdAt: row.createdAt as Date } : null;
      },
    ),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { ...data, id: `l-${nextLedgerId++}`, createdAt: new Date() };
      ledger.push(row);
      return { id: row.id };
    }),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = ledger.find((entry) => entry.id === where.id);
        if (!row) throw new Error("missing ledger row");
        Object.assign(row, data);
        return { id: where.id };
      },
    ),
  };
  const prisma = {
    _ledger: ledger,
    _runs: runs,
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
    compSearchRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        runs.push(data);
        return { id: `run-${runs.length}` };
      }),
    },
    providerCallLedger,
    $queryRawUnsafe: vi.fn(async (...args: [string, ...unknown[]]) => {
      void args;
      // pg_advisory_xact_lock returns `void`; real Prisma $queryRaw* throws here.
      if (opts.queryRawThrows) throw opts.queryRawThrows;
      return [];
    }),
    $executeRawUnsafe: vi.fn(async (...args: [string, ...unknown[]]) => {
      void args;
      if (opts.executeRawThrows) throw opts.executeRawThrows;
      return 1;
    }),
    $transaction: vi.fn(async <T>(callback: (tx: typeof prisma) => Promise<T>) => {
      let release = () => {};
      const previous = transactionTail;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback(prisma);
      } finally {
        release();
      }
    }),
  };
  return prisma;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runCompFetch paid-provider budget/quota gates", () => {
  it("shares paid-provider daily quota across account members", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    vi.stubEnv("COMPS_USER_DAILY_PROVIDER_CALL_LIMIT", "1");
    vi.stubEnv("COMPS_DRAFT_PROVIDER_COOLDOWN_SECONDS", "0");
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma();

    await runCompFetch(prisma as never, "item-1", "member-1", {
      paidProvidersAllowed: true,
      sources: [source],
      accountId: "acc-1",
      idempotencyKey: "member-one-refresh",
    });
    await runCompFetch(prisma as never, "item-1", "member-2", {
      paidProvidersAllowed: true,
      sources: [source],
      accountId: "acc-1",
      idempotencyKey: "member-two-refresh",
    });

    expect(source.fetchComps).toHaveBeenCalledTimes(1);
    expect(prisma._ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: "acc-1", userId: "member-1", status: "succeeded" }),
        expect.objectContaining({ accountId: "acc-1", userId: "member-2", skippedReason: "user_daily_quota_exceeded" }),
      ]),
    );
  });

  it("deduplicates the same account-scoped provider request before a second paid call", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    vi.stubEnv("COMPS_DRAFT_PROVIDER_COOLDOWN_SECONDS", "0");
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma();
    const options = {
      paidProvidersAllowed: true,
      sources: [source],
      accountId: "acc-1",
      idempotencyKey: "same-provider-request",
    };

    await runCompFetch(prisma as never, "item-1", "member-1", options);
    await runCompFetch(prisma as never, "item-1", "member-1", options);

    expect(source.fetchComps).toHaveBeenCalledTimes(1);
    expect(prisma._ledger).toHaveLength(1);
  });

  it("excludes paid providers before reservation when entitlement is absent", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma();

    const result = await runCompFetch(prisma as never, "item-1", "user-1", {
      sources: [source],
    });

    expect(source.fetchComps).not.toHaveBeenCalled();
    expect(prisma._ledger).toHaveLength(0);
    expect(result.status).toBe("source_unavailable");
  });

  it("skips paid providers (kill switch off by default) and logs the reason", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "");
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma();

    const result = await runCompFetch(prisma as never, "item-1", "user-1", {
      paidProvidersAllowed: true,
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

    await runCompFetch(prisma as never, "item-1", "user-1", {
      paidProvidersAllowed: true,
      sources: [source],
    });

    expect(source.fetchComps).toHaveBeenCalledTimes(1);
    const succeeded = prisma._ledger.find((r) => r.status === "succeeded");
    expect(succeeded).toMatchObject({
      provider: "apify-ebay-sold",
      status: "succeeded",
      fetchedCount: 3,
    });
    expect(succeeded?.estimatedCostCents).toBeGreaterThan(0);
    expect(succeeded?.queryHash).toBeTruthy();
    expect(prisma._ledger).toHaveLength(1);
  });

  it("creates the attempted reservation before provider execution and updates that row", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    const prisma = createPrisma();
    const source = paidSource(async () => {
      expect(prisma._ledger).toHaveLength(1);
      expect(prisma._ledger[0]).toMatchObject({
        status: "attempted",
        estimatedCostCents: 35,
      });
      return [soldComp(1)];
    });

    await runCompFetch(prisma as never, "item-1", "user-1", {
      paidProvidersAllowed: true,
      sources: [source],
    });

    expect(prisma._ledger).toHaveLength(1);
    expect(prisma._ledger[0]).toMatchObject({ status: "succeeded", fetchedCount: 1 });
    const lockKeys = prisma.$executeRawUnsafe.mock.calls.map((call) => call[1]);
    expect(lockKeys).toHaveLength(4);
    expect(lockKeys).toEqual([...lockKeys].sort());
    expect(lockKeys).toEqual(
      expect.arrayContaining([
        expect.stringContaining("paid-comps:global:"),
        expect.stringContaining("paid-comps:scope-day:account:acc-1:"),
        expect.stringContaining("paid-comps:scope-month:account:acc-1:"),
        expect.stringContaining(
          "paid-comps:draft:account:acc-1:apify-ebay-sold:draft-1",
        ),
      ]),
    );
  });

  it("skips when the global daily budget would be exceeded", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    vi.stubEnv("COMPS_APIFY_DAILY_BUDGET_CENTS", "35");
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma({ globalSpentCents: 20 });

    await runCompFetch(prisma as never, "item-1", "user-1", {
      paidProvidersAllowed: true,
      sources: [source],
    });

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

    await runCompFetch(prisma as never, "item-1", "user-1", {
      paidProvidersAllowed: true,
      sources: [source],
    });

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

    await runCompFetch(prisma as never, "item-1", "user-1", {
      paidProvidersAllowed: true,
      sources: [source],
    });

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

    await runCompFetch(prisma as never, "item-1", "user-1", {
      paidProvidersAllowed: true,
      sources: [source],
    });

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

    const result = await runCompFetch(prisma as never, "item-1", "user-1", {
      paidProvidersAllowed: true,
      sources: [source],
    });

    const failed = prisma._ledger.find((r) => r.status === "failed");
    expect(failed).toMatchObject({
      provider: "apify-ebay-sold",
      status: "failed",
      skippedReason: "provider_error",
    });
    expect(prisma._ledger).toHaveLength(1);
    expect(result.sourceErrors).toEqual([
      {
        source: "apify-ebay-sold",
        message: "Paid comp provider failed. Try again later.",
      },
    ]);
    const persistedAndReturned = JSON.stringify({
      ledger: prisma._ledger,
      runs: prisma._runs,
      result,
    });
    expect(persistedAndReturned).not.toContain("secret-apify-token");
    expect(persistedAndReturned).not.toContain("apify run failed");
  });

  it("does not retry the provider or log raw details when ledger completion fails", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma();
    prisma.providerCallLedger.update.mockRejectedValueOnce(
      new Error("completion failed with token secret-ledger-token"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runCompFetch(prisma as never, "item-1", "user-1", {
      paidProvidersAllowed: true,
      sources: [source],
    });

    expect(source.fetchComps).toHaveBeenCalledTimes(1);
    expect(result.fetched).toBe(1);
    expect(prisma._ledger[0]).toMatchObject({ status: "attempted", estimatedCostCents: 35 });
    expect(consoleError).toHaveBeenCalledWith("Paid comp provider ledger completion failed.");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret-ledger-token");
    consoleError.mockRestore();
  });

  it("serializes concurrent reservations so the global daily budget cannot be exceeded", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    vi.stubEnv("COMPS_APIFY_DAILY_BUDGET_CENTS", "35");
    vi.stubEnv("COMPS_USER_DAILY_PROVIDER_CALL_LIMIT", "10");
    vi.stubEnv("COMPS_DRAFT_PROVIDER_COOLDOWN_SECONDS", "0");
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma();

    await Promise.all([
      runCompFetch(prisma as never, "item-1", "user-1", {
        paidProvidersAllowed: true,
        sources: [source],
      }),
      runCompFetch(prisma as never, "item-1", "user-1", {
        paidProvidersAllowed: true,
        sources: [source],
      }),
    ]);

    expect(source.fetchComps).toHaveBeenCalledTimes(1);
    expect(prisma._ledger.filter((row) => row.status === "succeeded")).toHaveLength(1);
    expect(prisma._ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "skipped", skippedReason: "global_budget_exceeded" }),
      ]),
    );
  });

  it("serializes concurrent reservations so the per-user daily quota cannot be exceeded", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    vi.stubEnv("COMPS_APIFY_DAILY_BUDGET_CENTS", "1000");
    vi.stubEnv("COMPS_USER_DAILY_PROVIDER_CALL_LIMIT", "1");
    vi.stubEnv("COMPS_DRAFT_PROVIDER_COOLDOWN_SECONDS", "0");
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma();

    await Promise.all([
      runCompFetch(prisma as never, "item-1", "user-1", {
        paidProvidersAllowed: true,
        sources: [source],
      }),
      runCompFetch(prisma as never, "item-1", "user-1", {
        paidProvidersAllowed: true,
        sources: [source],
      }),
    ]);

    expect(source.fetchComps).toHaveBeenCalledTimes(1);
    expect(prisma._ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "skipped",
          skippedReason: "user_daily_quota_exceeded",
        }),
      ]),
    );
  });

  it("serializes concurrent reservations so the per-draft cooldown cannot be bypassed", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    vi.stubEnv("COMPS_APIFY_DAILY_BUDGET_CENTS", "1000");
    vi.stubEnv("COMPS_USER_DAILY_PROVIDER_CALL_LIMIT", "10");
    vi.stubEnv("COMPS_DRAFT_PROVIDER_COOLDOWN_SECONDS", "86400");
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma();

    await Promise.all([
      runCompFetch(prisma as never, "item-1", "user-1", {
        paidProvidersAllowed: true,
        sources: [source],
      }),
      runCompFetch(prisma as never, "item-1", "user-1", {
        paidProvidersAllowed: true,
        sources: [source],
      }),
    ]);

    expect(source.fetchComps).toHaveBeenCalledTimes(1);
    expect(prisma._ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "skipped", skippedReason: "draft_cooldown_active" }),
      ]),
    );
  });

  it("skips paid calls for weak-identity items under auto discovery", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    vi.stubEnv("COMPS_AUTO_DISCOVERY_ENABLED", "true");
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma({
      item: { ...strongItem, brand: "unknown", confidence: 0.2 },
    });

    const result = await runCompFetch(prisma as never, "item-1", "user-1", {
      force: true,
      paidProvidersAllowed: true,
      sources: [source],
    });

    expect(source.fetchComps).not.toHaveBeenCalled();
    expect(result.status).toBe("skipped_weak_identity");
    expect(prisma._ledger[0]).toMatchObject({
      status: "skipped",
      skippedReason: "weak_identity",
      estimatedCostCents: 0,
    });
  });

  it("acquires advisory locks without a void-deserializing $queryRaw (Prisma void regression)", async () => {
    // Real Postgres: pg_advisory_xact_lock() returns SQL `void`, and Prisma's
    // $queryRaw* throws "Failed to deserialize column of type 'void'". The lock
    // MUST go through $executeRawUnsafe (no column deserialization) instead.
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    const voidError = new Error(
      "Inconsistent column data: Failed to deserialize column of type 'void'.",
    );
    const source = paidSource(async () => [soldComp(1)]);
    const prisma = createPrisma({ queryRawThrows: voidError });

    const result = await runCompFetch(prisma as never, "item-1", "user-1", {
      paidProvidersAllowed: true,
      sources: [source],
    });

    // The buggy path would have thrown the void error; the fixed path runs cleanly.
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
    expect(source.fetchComps).toHaveBeenCalledTimes(1);
    expect(prisma._ledger.find((r) => r.status === "succeeded")).toBeTruthy();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("void");
    expect(serialized).not.toContain("deserialize");
  });

  it("degrades safely (free sources still run) when reserving a paid provider throws", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    const dbError = new Error(
      "PrismaClientKnownRequestError: the table does not exist. token=secret-xyz",
    );
    const freeSource: CompSource = {
      id: "ebay-browse",
      displayName: "eBay active",
      sold: false,
      resultKind: "active_listings",
      isEnabled: () => true,
      fetchComps: vi.fn(async () => [{ ...soldComp(1), source: "ebay-browse", sold: false }]),
    };
    const paid = paidSource(async () => [soldComp(2)]);
    const prisma = createPrisma({ executeRawThrows: dbError });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runCompFetch(prisma as never, "item-1", "user-1", {
      paidProvidersAllowed: true,
      sources: [freeSource, paid],
    });

    // Free source still ran; paid source was skipped, not fatal.
    expect(freeSource.fetchComps).toHaveBeenCalledTimes(1);
    expect(paid.fetchComps).not.toHaveBeenCalled();
    // The paid skip surfaces a sanitized note; no raw DB text or token leaks.
    expect(result.sourceErrors).toEqual(
      expect.arrayContaining([
        { source: "apify-ebay-sold", message: "Paid comp provider failed. Try again later." },
      ]),
    );
    const serialized = JSON.stringify({ result, logs: consoleError.mock.calls });
    expect(serialized).not.toContain("secret-xyz");
    expect(serialized).not.toContain("does not exist");
    consoleError.mockRestore();
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
      paidProvidersAllowed: true,
      sources: [freeSource, paid],
    });

    expect(freeSource.fetchComps).toHaveBeenCalledTimes(1);
    expect(paid.fetchComps).not.toHaveBeenCalled();
    expect(prisma.priceComp.createMany).toHaveBeenCalled();
  });
});
