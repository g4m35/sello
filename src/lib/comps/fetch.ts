import type { Prisma } from "@/generated/prisma/client";
import {
  compsAutoMinIdentityConfidence,
  compsMaxQueryVariants,
  isCompsAutoDiscoveryEnabled,
} from "@/lib/comps/flags";
import { buildCompQuery } from "@/lib/comps/match";
import { dedupeComps, toPriceCompCreate, trimOutliers } from "@/lib/comps/normalize";
import {
  evaluatePaidProviderGate,
  loadPaidGateConfig,
} from "@/lib/comps/provider-budget";
import {
  hashQueries,
  loadPaidGateUsage,
  recordProviderCall,
  type ProviderLedgerPrismaLike,
} from "@/lib/comps/provider-ledger";
import { enabledCompSources } from "@/lib/comps/registry";
import { scoreCompMatch } from "@/lib/comps/scoring";
import type { CompSource, NormalizedComp } from "@/lib/comps/source";
import { summarizeComps } from "@/lib/pricing/summarize";
import { getPrisma } from "@/lib/prisma";

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
};

export function isAutoDiscoveryEnabled(): boolean {
  return isCompsAutoDiscoveryEnabled();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Source failed.";
}

async function fetchFromSource(
  source: CompSource,
  query: ReturnType<typeof buildCompQuery>,
): Promise<{ source: CompSource; comps: NormalizedComp[]; error: string | null }> {
  try {
    const comps = await source.fetchComps(query);
    return { source, comps, error: null };
  } catch (error) {
    return { source, comps: [], error: errorMessage(error) };
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
// are left untouched. The lookup is scoped to the owning seller so the helper is
// safe even if a caller forgets to verify ownership first.
export async function runCompFetch(
  prisma: Db,
  inventoryItemId: string,
  sellerId: string,
  options: RunCompFetchOptions = {},
): Promise<CompFetchResult> {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: inventoryItemId, sellerId },
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
  const sources = options.sources ?? enabledCompSources();
  const draft = item.listingDrafts[0] ?? null;
  const query = capQueryVariants(buildCompQuery({
    productName: draft?.title || item.productName,
    brand: item.brand,
    styleCode: item.styleCode,
    size: item.size,
    category: item.category,
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
  const paidSources = sources.filter((source) => source.paid === true);
  const paidConfig = paidSources.length > 0 ? loadPaidGateConfig() : null;
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

  if (autoDiscoveryEnabled && !options.force && !hasMeaningfulIdentity(item)) {
    if (paidSources.length > 0) {
      await recordProviderCall(ledgerPrisma, {
        userId: sellerId,
        draftId,
        inventoryItemId,
        provider: paidSources[0].id,
        status: "skipped",
        skippedReason: "weak_identity",
        estimatedCostCents: 0,
        fetchedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        queryHash,
      });
    }
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
        sourceErrors: [
          {
            source: "sello",
            message: "Automatic comps skipped until item identity is specific enough.",
          },
        ],
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
      sourceErrors: [
        {
          source: "sello",
          message: "Automatic comps skipped until item identity is specific enough.",
        },
      ],
      summary: emptySummary(),
      appliedPriceCents: null,
    };
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
  let runnablePaidSources = paidSources;
  const budgetSkipErrors: { source: string; message: string }[] = [];
  if (paidSources.length > 0 && paidConfig) {
    const usage = await loadPaidGateUsage(ledgerPrisma, { userId: sellerId, draftId, now });
    const gate = evaluatePaidProviderGate({ config: paidConfig, usage, now });
    if (!gate.allowed) {
      runnablePaidSources = [];
      budgetSkipErrors.push({
        source: paidSources[0].id,
        message: `Paid comp providers skipped: ${gate.reason}.`,
      });
      await recordProviderCall(ledgerPrisma, {
        userId: sellerId,
        draftId,
        inventoryItemId,
        provider: paidSources[0].id,
        status: "skipped",
        skippedReason: gate.reason,
        estimatedCostCents: 0,
        fetchedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        queryHash,
      });
    }
  }
  const runSources = [
    ...sources.filter((source) => source.paid !== true),
    ...runnablePaidSources,
  ];

  const sourceResults = await Promise.all(runSources.map((source) => fetchFromSource(source, query)));
  const sourceErrors = [
    ...sourceResults.flatMap((result) =>
      result.error ? [{ source: result.source.id, message: result.error }] : [],
    ),
    ...budgetSkipErrors,
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
  const accepted = comps.filter(
    (comp) => comp.matchClassification === "strong" || comp.matchClassification === "possible",
  ).length;
  const rejected = comps.length - accepted;
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

  // Record each paid provider call that actually ran (cost is incurred whether or
  // not it returned usable comps). Failures are logged without leaking secrets.
  if (paidConfig) {
    for (const result of sourceResults) {
      if (result.source.paid === true) {
        await recordProviderCall(ledgerPrisma, {
          userId: sellerId,
          draftId,
          inventoryItemId,
          provider: result.source.id,
          status: result.error ? "failed" : "succeeded",
          skippedReason: result.error ? "provider_error" : null,
          estimatedCostCents: paidConfig.estimatedCostCents,
          fetchedCount: result.comps.length,
          acceptedCount: accepted,
          rejectedCount: rejected,
          queryHash,
        });
      }
    }
  }

  const status: CompFetchResult["status"] =
    comps.length === 0
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
