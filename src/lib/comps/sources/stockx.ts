import type { CompQuery, CompSource, NormalizedComp } from "@/lib/comps/source";
import { fetchStockXMarketData } from "@/lib/marketplace/adapters/stockx/client";
import {
  getStockXMarketDataConfig,
  isStockXApiEnabled,
  isStockXMarketDataEnabled,
} from "@/lib/marketplace/adapters/stockx/config";
import { StockXIntegrationError, stockxErrorCodes } from "@/lib/marketplace/adapters/stockx/errors";
import { loadStockXConnectionSession } from "@/lib/marketplace/adapters/stockx/session";
import { getPrisma } from "@/lib/prisma";

type Env = Record<string, string | undefined>;

// Soft skip: account has a StockX product match but no OAuth connection yet.
// Thrown so the comps pipeline can mark the ledger as not-configured instead of
// a hard provider_error (and so seller copy can say "connect StockX").
export class StockXCompsNotConnectedError extends Error {
  readonly code = "stockx_not_connected";

  constructor() {
    super("Connect StockX to include StockX sold comps.");
    this.name = "StockXCompsNotConnectedError";
  }
}

// StockX API = sneaker/streetwear market data. It is a paid/partner provider,
// so the shared provider budget ledger gates calls before fetchComps runs.
export const stockxSource: CompSource = {
  id: "stockx",
  displayName: "StockX",
  // Official StockX market-data is live ask/bid levels, not completed sales.
  sold: false,
  resultKind: "active_listings",
  paid: true,
  isEnabled() {
    return isStockXMarketDataConfigured();
  },
  async fetchComps(query: CompQuery): Promise<NormalizedComp[]> {
    if (!query.accountId || !query.stockxProductId) return [];

    const prisma = getPrisma();
    const config = getStockXMarketDataConfig();
    let session;
    try {
      session = await loadStockXConnectionSession(prisma, query.accountId, config);
    } catch (error) {
      if (
        error instanceof StockXIntegrationError &&
        (error.code === stockxErrorCodes.notConnected ||
          error.code === stockxErrorCodes.reconnectRequired)
      ) {
        throw new StockXCompsNotConnectedError();
      }
      throw error;
    }

    const rows = await fetchStockXMarketData(config, session.accessToken, {
      productId: query.stockxProductId,
      variantId: query.stockxVariantId,
      currencyCode: "USD",
    });

    if (query.draftId) {
      await prisma.listingDraft.update({
        where: { id: query.draftId },
        data: { stockxMarketDataCheckedAt: new Date() },
      }).catch(() => undefined);
    }

    return rows.map((row): NormalizedComp => {
      const isCompletedSale = Boolean(row.soldDate);
      return {
        source: "stockx",
        externalId: row.externalId,
        title: row.title,
        priceCents: row.priceCents,
        shippingCents: 0,
        currency: row.currency,
        soldDate: row.soldDate,
        url: row.url,
        imageUrl: row.imageUrl,
        sold: isCompletedSale,
        condition: "unknown",
        brand: row.brand,
        size: row.size ?? query.size,
        category: row.category ?? query.category,
        rawJson: row.rawJson,
      };
    });
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
