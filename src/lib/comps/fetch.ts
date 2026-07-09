import type { Prisma } from "@/generated/prisma/client";
import {
  compsAutoMinIdentityConfidence,
  compsMaxQueryVariants,
  isCompsAutoDiscoveryEnabled,
} from "@/lib/comps/flags";
import { buildCompQuery } from "@/lib/comps/match";
import { dedupeComps, toPriceCompCreate, trimOutliers } from "@/lib/comps/normalize";
import { loadPaidGateConfig } from "@/lib/comps/provider-budget";
import {
  completeProviderCall,
  hashQueries,
  recordProviderCall,
  reservePaidProviderCall,
  type PaidProviderReservation,
  type ProviderLedgerPrismaLike,
} from "@/lib/comps/provider-ledger";
import { logUnexpectedError } from "@/lib/errors";
import { enabledCompSources } from "@/lib/comps/registry";
import { scoreCompMatch } from "@/lib/comps/scoring";
import type { CompSource, NormalizedComp } from "@/lib/comps/source";
import { StockXCompsNotConnectedError } from "@/lib/comps/sources/stockx";
import { summarizeComps } from "@/lib/pricing/summarize";
import { getPrisma } from "@/lib/prisma";

export const MARKETPLACE_NOT_CONNECTED_SKIP = "marketplace_not_connected";

type Db = ReturnType<typeof getPrisma>;

export type CompFetchResult = {
  fetched: number;
  accepted: number;
  rejected: number;
  sources: string[];
  enabled: number;
  status:
    | "disabled"
    | "skipped_weak_identity"
    | "source_unavailable"
    | "no_comps_found"
    | "needs_review"
    | "found_comps"
    | "auto_priced"
    | "error";
  queries: string[];
  sourceErrors: { source: string; message: string }[];
  summary: ReturnType<typeof summarizeComps>;
  appliedPriceCents: number | null;
};

export type RunCompFetchOptions = {
  sources?: CompSource[];
  force?: boolean;
  paidProvidersAllowed?: boolean;
  accountId?: string;
  /** When true (admin identity), bypass paid-provider budget/quota/cooldown. */
  adminOverride?: boolean;
};

export function isAutoDiscoveryEnabled(): boolean {
  return isCompsAutoDiscoveryEnabled();
}

export function sanitizeProviderError(source: Pick<CompSource, "paid">): string {
  return source.paid === true
    ? "Paid comp provider failed. Try again later."
    : "Comp provider failed. Try again later.";
}

async function fetchFromSource(
  source: CompSource,
  query: ReturnType<typeof buildCompQuery>,
): Promise<{ source: CompSource; comps: NormalizedComp[]; error: string | null }> {
  try {
    const comps = await source.fetchComps(query);
    return { source, comps, error: null };
  } catch (error) {
    if (error instanceof StockXCompsNotConnectedError) {
      return { source, comps: [], error: MARKETPLACE_NOT_CONNECTED_SKIP };
    }
    // Always record the source id + error name/code (never tokens/bodies) so
    // provider_error ledger rows are diagnosable without swallowing AppErrors.
    const name = error instanceof Error ? error.name : typeof error;
    const code =
      error && typeof error === "object" && "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    console.error(
      `[comp_source_fetch:${source.id}] ${name}${code ? ` (${code})` : ""}`,
    );
    logUnexpectedError(`comp_source_fetch:${source.id}`, error);
    return { source, comps: [], error: sanitizeProviderError(source) };
  }
}

function emptySummary() {
  return summarizeComps([]);
}

function capQueryVariants(query: ReturnType<typeof buildCompQuery>) {
  const maxVariants = compsMaxQueryVariants();
  const variants = query.variants?.slice(0, maxVariants);
  return {
    ...query,
    variants,
  };
}

function isUnknownBrand(brand: string | null | undefined): boolean {
  const normalized = (brand ?? "").trim().toLowerCase();
  return normalized.length === 0 || normalized === "unknown" || normalized === "unbranded";
}

function hasMeaningfulIdentity(item: {
  brand?: string | null;
  styleCode?: string | null;
  size?: string | null;
  confidence?: number | null;
}) {
  if ((item.styleCode ?? "").trim().length > 0) return true;
  const minConfidence = compsAutoMinIdentityConfidence();
  const hasKnownBrand = !isUnknownBrand(item.brand);
  const hasSize = (item.size ?? "").trim().length > 0;
  const confidence = typeof item.confidence === "number" ? item.confidence : 0;
  return hasKnownBrand && hasSize && confidence >= minConfidence;
}

// Runs every enabled comp source for an item, dedupes + trims outliers, and
// replaces the item's automatic comps (source "auto:*"). Manual comps, if any,
// are left untouched. Routes pass accountId so team members share the same
// inventory; the sellerId fallback keeps older direct callers fail-closed.
export async function runCompFetch(
  prisma: Db,
  inventoryItemId: string,
  sellerId: string,
  options: RunCompFetchOptions = {},
): Promise<CompFetchResult> {
  const item = await prisma.inventoryItem.findFirst({
    where: options.accountId
      ? { id: inventoryItemId, accountId: options.accountId }
      : { id: inventoryItemId, sellerId },
    include: { listingDrafts: { orderBy: { updatedAt: "desc" }, take: 1 } },
  });
  if (!item) {
    return {
      fetched: 0,
      accepted: 0,
      rejected: 0,
      sources: [],
      enabled: 0,
      status: "error",
      queries: [],
      sourceErrors: [{ source: "sello", message: "Item not found." }],
      summary: emptySummary(),
      appliedPriceCents: null,
    };
  }

  const autoDiscoveryEnabled = isAutoDiscoveryEnabled();
  const configuredSources = options.sources ?? enabledCompSources();
  const freeSources = configuredSources.filter((source) => source.paid !== true);
  const paidSources = options.paidProvidersAllowed === true
    ? configuredSources.filter((source) => source.paid === true)
    : [];
  const sources = [...freeSources, ...paidSources];
  const draft = item.listingDrafts[0] ?? null;
  const query = capQueryVariants(buildCompQuery({
    accountId: item.accountId,
    draftId: draft?.id ?? null,
    productName: draft?.title || item.productName,
    brand: item.brand,
    styleCode: item.styleCode,
    size: item.size,
    category: item.category,
    stockxProductId: draft?.stockxProductId ?? null,
    stockxVariantId: draft?.stockxVariantId ?? null,
    colorway: item.colorway,
    condition: item.condition,
    description: draft?.description ?? null,
  }));
  const queries = (query.variants?.map((variant) => variant.keywords) ?? [query.keywords]).filter(
    Boolean,
  );

  // Paid-provider (e.g. Apify) cost/quota accounting context.
  const ledgerPrisma = prisma as unknown as ProviderLedgerPrismaLike;
  const draftId = draft?.id ?? null;
  const queryHash = hashQueries(queries);
  const paidConfig =
    paidSources.length > 0
      ? {
          ...loadPaidGateConfig(),
          ...(options.adminOverride === true ? { adminOverride: true } : {}),
        }
      : null;
  const now = new Date();

  if (!autoDiscoveryEnabled && !options.sources && !options.force) {
    await prisma.compSearchRun.create({
      data: {
        inventoryItemId,
        status: "disabled",
        autoDiscoveryEnabled,
        sourceCount: 0,
        fetchedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        recommendedPriceCents: null,
        confidence: "none",
        queries: queries as Prisma.InputJsonValue,
        sourcesChecked: [],
        sourceErrors: [],
      },
    });
    return {
      fetched: 0,
      accepted: 0,
      rejected: 0,
      sources: [],
      enabled: 0,
      status: "disabled",
      queries,
      sourceErrors: [],
      summary: emptySummary(),
      appliedPriceCents: null,
    };
  }

  const paidSourcesSkippedForWeakIdentity =
    paidSources.length > 0 && !hasMeaningfulIdentity(item);
  const weakIdentityError = {
    source: "sello",
    message: "Fresh sold comps skipped until item identity is specific enough.",
  };

  if (paidSourcesSkippedForWeakIdentity) {
    for (const paidSource of paidSources) {
      try {
        await recordProviderCall(ledgerPrisma, {
          userId: sellerId,
          draftId,
          inventoryItemId,
          provider: paidSource.id,
          status: "skipped",
          skippedReason: "weak_identity",
          estimatedCostCents: 0,
          fetchedCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          queryHash,
        });
      } catch (error) {
        // The skip ledger is best-effort accounting. A DB hiccup here must not
        // throw a raw error up to the route; the weak-identity skip still stands.
        logUnexpectedError("paid_comp_skip_record", error);
      }
    }
    if (freeSources.length === 0) {
      await prisma.compSearchRun.create({
        data: {
          inventoryItemId,
          status: "skipped_weak_identity",
          autoDiscoveryEnabled,
          sourceCount: 0,
          fetchedCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          recommendedPriceCents: null,
          confidence: "none",
          queries: queries as Prisma.InputJsonValue,
          sourcesChecked: [],
          sourceErrors: [weakIdentityError],
        },
      });
      return {
        fetched: 0,
        accepted: 0,
        rejected: 0,
        sources: [],
        enabled: 0,
        status: "skipped_weak_identity",
        queries,
        sourceErrors: [weakIdentityError],
        summary: emptySummary(),
        appliedPriceCents: null,
      };
    }
  }

  if (sources.length === 0) {
    await prisma.compSearchRun.create({
      data: {
        inventoryItemId,
        status: "source_unavailable",
        autoDiscoveryEnabled,
        sourceCount: 0,
        fetchedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        recommendedPriceCents: null,
        confidence: "none",
        queries: queries as Prisma.InputJsonValue,
        sourcesChecked: [],
        sourceErrors: [],
      },
    });
    return {
      fetched: 0,
      accepted: 0,
      rejected: 0,
      sources: [],
      enabled: 0,
      status: "source_unavailable",
      queries,
      sourceErrors: [],
      summary: emptySummary(),
      appliedPriceCents: null,
    };
  }

  // Budget/quota gate for paid providers — checked server-side BEFORE any paid
  // call. A blocked gate skips paid execution, records a typed skipped ledger
  // row, and surfaces the reason; free sources and manual comps are unaffected.
  const runnablePaidSources: CompSource[] = [];
  const paidReservations = new Map<string, string>();
  const budgetSkipErrors: { source: string; message: string }[] = [];
  if (!paidSourcesSkippedForWeakIdentity && paidSources.length > 0 && paidConfig) {
    for (const paidSource of paidSources) {
      let reservation: PaidProviderReservation;
      try {
        reservation = await reservePaidProviderCall(ledgerPrisma, {
          config: paidConfig,
          userId: sellerId,
          draftId,
          inventoryItemId,
          provider: paidSource.id,
          queryHash,
          now,
        });
      } catch (error) {
        // The reservation runs a DB transaction (advisory locks + ledger writes).
        // If that fails (migration not applied, transient DB error, etc.), degrade
        // safely: skip this paid source, surface a sanitized note, and let free +
        // manual comps proceed. Never let a raw DB/Prisma error reach the route.
        logUnexpectedError("paid_comp_reservation", error);
        budgetSkipErrors.push({
          source: paidSource.id,
          message: sanitizeProviderError(paidSource),
        });
        continue;
      }
      if (reservation.allowed) {
        runnablePaidSources.push(paidSource);
        paidReservations.set(paidSource.id, reservation.reservationId);
      } else {
        budgetSkipErrors.push({
          source: paidSource.id,
          message: `Paid comp providers skipped: ${reservation.reason}`,
        });
      }
    }
  }
  const runSources = [
    ...freeSources,
    ...runnablePaidSources,
  ];

  const sourceResults = await Promise.all(runSources.map((source) => fetchFromSource(source, query)));
  const sourceErrors = [
    ...sourceResults.flatMap((result) =>
      result.error ? [{ source: result.source.id, message: result.error }] : [],
    ),
    ...budgetSkipErrors,
    ...(paidSourcesSkippedForWeakIdentity ? [weakIdentityError] : []),
  ];
  const scored = dedupeComps(sourceResults.flatMap((result) => result.comps)).map((comp) => {
    const score = scoreCompMatch(
      {
        productName: draft?.title || item.productName,
        brand: item.brand,
        styleCode: item.styleCode,
        size: item.size,
        category: item.category,
        colorway: item.colorway,
        condition: item.condition,
      },
      comp,
    );
    return {
      ...comp,
      matchScore: score.score,
      matchClassification: score.classification,
      matchReasons: score.reasons,
    };
  });
  const acceptedForOutlierTrim = trimOutliers(
    scored.filter(
      (comp) => comp.matchClassification === "strong" || comp.matchClassification === "possible",
    ),
  );
  const acceptedKeys = new Set(
    acceptedForOutlierTrim.map((comp) =>
      comp.externalId ? `${comp.source}:${comp.externalId}` : `${comp.source}:${comp.url ?? ""}:${comp.priceCents}`,
    ),
  );
  const comps = scored.map((comp) => {
    const key = comp.externalId
      ? `${comp.source}:${comp.externalId}`
      : `${comp.source}:${comp.url ?? ""}:${comp.priceCents}`;
    return acceptedKeys.has(key)
      ? comp
      : {
          ...comp,
          matchClassification: "rejected" as const,
          matchReasons: [...(comp.matchReasons ?? []), "Filtered out of automatic pricing."],
        };
  });

  const accepted = comps.filter(
    (comp) => comp.matchClassification === "strong" || comp.matchClassification === "possible",
  ).length;
  const rejected = comps.length - accepted;

  if (paidConfig) {
    for (const result of sourceResults) {
      const reservationId = paidReservations.get(result.source.id);
      if (!reservationId) continue;
      const sourceComps = comps.filter((comp) => comp.source === result.source.id);
      const sourceAccepted = sourceComps.filter(
        (comp) =>
          comp.matchClassification === "strong" || comp.matchClassification === "possible",
      ).length;
      try {
        const notConnected = result.error === MARKETPLACE_NOT_CONNECTED_SKIP;
        await completeProviderCall(ledgerPrisma, {
          reservationId,
          status: notConnected ? "skipped" : result.error ? "failed" : "succeeded",
          skippedReason: notConnected
            ? "provider_not_configured"
            : result.error
              ? "provider_error"
              : null,
          estimatedCostCents: notConnected ? 0 : paidConfig.estimatedCostCents,
          fetchedCount: result.comps.length,
          acceptedCount: sourceAccepted,
          rejectedCount: sourceComps.length - sourceAccepted,
        });
      } catch {
        // The provider call already happened. Keep the reservation charged and
        // never replay the external request merely to repair accounting state.
        console.error("Paid comp provider ledger completion failed.");
      }
    }
  }

  await prisma.priceComp.deleteMany({
    where: { inventoryItemId, source: { startsWith: "auto:" } },
  });
  if (comps.length > 0) {
    await prisma.priceComp.createMany({
      data: comps.map((c) => toPriceCompCreate(inventoryItemId, c) as Prisma.PriceCompCreateManyInput),
    });
  }

  const savedComps = await prisma.priceComp.findMany({
    where: { inventoryItemId },
    orderBy: { createdAt: "desc" },
  });
  const summary = summarizeComps(savedComps);
  let appliedPriceCents: number | null = null;

  if (
    summary.confidence === "high" &&
    summary.recommendedListCents != null &&
    item.recommendedPriceCents == null
  ) {
    appliedPriceCents = summary.recommendedListCents;
    await prisma.inventoryItem.update({
      where: { id: inventoryItemId },
      data: { recommendedPriceCents: appliedPriceCents },
    });
    if (draft?.id && draft.recommendedPriceCents == null) {
      await prisma.listingDraft.update({
        where: { id: draft.id },
        data: { recommendedPriceCents: appliedPriceCents },
      });
    }
  }

  const status: CompFetchResult["status"] =
    paidSourcesSkippedForWeakIdentity && accepted === 0
      ? "skipped_weak_identity"
      : comps.length === 0
      ? runSources.length > 0 && sourceResults.every((result) => result.error)
        ? "error"
        : "no_comps_found"
      : appliedPriceCents != null
        ? "auto_priced"
        : summary.confidence === "low" || summary.confidence === "none"
          ? "needs_review"
          : "found_comps";

  await prisma.compSearchRun.create({
    data: {
      inventoryItemId,
      status,
      autoDiscoveryEnabled,
      sourceCount: runSources.length,
      fetchedCount: comps.length,
      acceptedCount: accepted,
      rejectedCount: rejected,
      recommendedPriceCents: summary.recommendedListCents,
      confidence: summary.confidence,
      queries: queries as Prisma.InputJsonValue,
      sourcesChecked: runSources.map((source) => source.id),
      sourceErrors: sourceErrors as Prisma.InputJsonValue,
    },
  });

  return {
    fetched: comps.length,
    accepted,
    rejected,
    sources: runSources.map((s) => s.id),
    enabled: runSources.length,
    status,
    queries,
    sourceErrors,
    summary,
    appliedPriceCents,
  };
}
