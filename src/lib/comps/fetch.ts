import type { Prisma } from "@/generated/prisma/client";
import { buildCompQuery } from "@/lib/comps/match";
import { dedupeComps, toPriceCompCreate, trimOutliers } from "@/lib/comps/normalize";
import { enabledCompSources } from "@/lib/comps/registry";
import { getPrisma } from "@/lib/prisma";

type Db = ReturnType<typeof getPrisma>;

export type CompFetchResult = {
  fetched: number;
  sources: string[];
  enabled: number;
};

// Runs every enabled comp source for an item, dedupes + trims outliers, and
// replaces the item's automatic comps (source "auto:*"). Manual comps, if any,
// are left untouched. Ownership must be verified by the caller.
export async function runCompFetch(
  prisma: Db,
  inventoryItemId: string,
): Promise<CompFetchResult> {
  const item = await prisma.inventoryItem.findUnique({
    where: { id: inventoryItemId },
    include: { listingDrafts: { orderBy: { updatedAt: "desc" }, take: 1 } },
  });
  if (!item) return { fetched: 0, sources: [], enabled: 0 };

  const sources = enabledCompSources();
  if (sources.length === 0) return { fetched: 0, sources: [], enabled: 0 };

  const query = buildCompQuery({
    productName: item.listingDrafts[0]?.title || item.productName,
    brand: item.brand,
    styleCode: item.styleCode,
    size: item.size,
    category: item.category,
  });

  const results = await Promise.all(
    sources.map((source) => source.fetchComps(query).catch(() => [])),
  );
  const comps = trimOutliers(dedupeComps(results.flat()));

  await prisma.priceComp.deleteMany({
    where: { inventoryItemId, source: { startsWith: "auto:" } },
  });
  if (comps.length > 0) {
    await prisma.priceComp.createMany({
      data: comps.map((c) => toPriceCompCreate(inventoryItemId, c) as Prisma.PriceCompCreateManyInput),
    });
  }

  return { fetched: comps.length, sources: sources.map((s) => s.id), enabled: sources.length };
}
