import type { Prisma } from "@/generated/prisma/client";
import { isCompsAutoDiscoveryEnabled } from "@/lib/comps/flags";
import { buildCompQuery } from "@/lib/comps/match";
import { dedupeComps, toPriceCompCreate, trimOutliers } from "@/lib/comps/normalize";
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
  const query = buildCompQuery({
    productName: draft?.title || item.productName,
    brand: item.brand,
    styleCode: item.styleCode,
    size: item.size,
    category: item.category,
    colorway: item.colorway,
    condition: item.condition,
    description: draft?.description ?? null,
  });
  const queries = (query.variants?.map((variant) => variant.keywords) ?? [query.keywords]).filter(
    Boolean,
  );

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

  const sourceResults = await Promise.all(sources.map((source) => fetchFromSource(source, query)));
  const sourceErrors = sourceResults.flatMap((result) =>
    result.error ? [{ source: result.source.id, message: result.error }] : [],
  );
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

  const status: CompFetchResult["status"] =
    comps.length === 0
      ? sourceErrors.length === sources.length
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
      sourceCount: sources.length,
      fetchedCount: comps.length,
      acceptedCount: accepted,
      rejectedCount: rejected,
      recommendedPriceCents: summary.recommendedListCents,
      confidence: summary.confidence,
      queries: queries as Prisma.InputJsonValue,
      sourcesChecked: sources.map((source) => source.id),
      sourceErrors: sourceErrors as Prisma.InputJsonValue,
    },
  });

  return {
    fetched: comps.length,
    accepted,
    rejected,
    sources: sources.map((s) => s.id),
    enabled: sources.length,
    status,
    queries,
    sourceErrors,
    summary,
    appliedPriceCents,
  };
}
