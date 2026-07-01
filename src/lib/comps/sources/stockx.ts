import type { CompQuery, CompSource, NormalizedComp } from "@/lib/comps/source";
import { fetchStockXMarketData } from "@/lib/marketplace/adapters/stockx/client";
import {
  getStockXMarketDataConfig,
  isStockXApiEnabled,
  isStockXMarketDataEnabled,
} from "@/lib/marketplace/adapters/stockx/config";
import { loadStockXConnectionSession } from "@/lib/marketplace/adapters/stockx/session";
import { getPrisma } from "@/lib/prisma";

type Env = Record<string, string | undefined>;

// StockX API = sneaker/streetwear market data. It is a paid/partner provider,
// so the shared provider budget ledger gates calls before fetchComps runs.
export const stockxSource: CompSource = {
  id: "stockx",
  displayName: "StockX",
  sold: true,
  resultKind: "sold_comps",
  paid: true,
  isEnabled() {
    return isStockXMarketDataConfigured();
  },
  async fetchComps(query: CompQuery): Promise<NormalizedComp[]> {
    if (!query.accountId || !query.stockxProductId) return [];

    const prisma = getPrisma();
    const config = getStockXMarketDataConfig();
    const session = await loadStockXConnectionSession(prisma, query.accountId, config);
    const rows = await fetchStockXMarketData(config, session.accessToken, {
      productId: query.stockxProductId,
      variantId: query.stockxVariantId,
    });

    if (query.draftId) {
      await prisma.listingDraft.update({
        where: { id: query.draftId },
        data: { stockxMarketDataCheckedAt: new Date() },
      }).catch(() => undefined);
    }

    return rows.map((row): NormalizedComp => ({
      source: "stockx",
      externalId: row.externalId,
      title: row.title,
      priceCents: row.priceCents,
      shippingCents: 0,
      currency: row.currency,
      soldDate: row.soldDate,
      url: row.url,
      imageUrl: row.imageUrl,
      sold: true,
      condition: "unknown",
      brand: row.brand,
      size: row.size,
      category: row.category,
      rawJson: row.rawJson,
    }));
  },
};

function isStockXMarketDataConfigured(env: Env = process.env): boolean {
  return (
    isStockXApiEnabled(env) &&
    isStockXMarketDataEnabled(env) &&
    hasValue(env.STOCKX_CLIENT_ID) &&
    hasValue(env.STOCKX_CLIENT_SECRET) &&
    hasValue(env.STOCKX_API_KEY) &&
    hasValue(env.STOCKX_REDIRECT_URI) &&
    hasValue(env.STOCKX_TOKEN_ENCRYPTION_KEY)
  );
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value && !value.includes("["));
}
