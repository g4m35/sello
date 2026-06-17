import { isApifyEbaySoldEnabled } from "@/lib/comps/flags";
import type { CompQuery, NormalizedComp, SoldCompSource } from "@/lib/comps/source";

// eBay sold-listings comps via an Apify actor (third-party scraper service —
// eBay Marketplace Insights, the official sold-comps API, is access-restricted).
//
// Env (all required to run; OFF by default):
//   COMPS_APIFY_EBAY_SOLD_ENABLED=true   enable flag (legacy: PRICE_COMP_APIFY_EBAY_SOLD_ENABLED)
//   APIFY_TOKEN                          Apify API token (sent as a Bearer header, never logged)
//   APIFY_EBAY_SOLD_ACTOR                actor id/slug to run (e.g. "user~ebay-sold-scraper")
//
// The integration is failure-safe: any disabled flag, missing actor, network
// error, non-2xx response, or unparseable payload yields [] so a provider
// problem can never break draft generation or comp refresh.

type Env = Record<string, string | undefined>;

const SOURCE_ID = "apify-ebay-sold";
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_ITEMS = 30;

export type ApifyEbaySoldDeps = {
  env?: Env;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function actorEndpoint(actor: string): string {
  // run-sync-get-dataset-items runs the actor and returns its dataset items in
  // one synchronous call. The token is supplied via the Authorization header so
  // it never appears in the URL.
  return `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?clean=true&format=json`;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

// Parses a price that may arrive as a number, a "$1,234.56" string, or a
// { value, currency } object. Returns cents, or null when not a usable USD price.
function priceToCents(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
  }
  if (typeof value === "string") {
    if (/[a-z]{3}/i.test(value.replace(/usd/i, "")) && !/usd|\$/i.test(value)) {
      // Has some non-USD currency word and no USD marker.
      return null;
    }
    const cleaned = value.replace(/[^0-9.]/g, "");
    if (!cleaned) return null;
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
  }
  if (value && typeof value === "object") {
    const obj = value as { value?: unknown; amount?: unknown; currency?: unknown };
    const currency = typeof obj.currency === "string" ? obj.currency.toUpperCase() : "USD";
    if (currency !== "USD") return null;
    return priceToCents(obj.value ?? obj.amount ?? null);
  }
  return null;
}

function priceToUsdCents(value: unknown, currencyValue?: unknown): number | null {
  const currency =
    typeof currencyValue === "string" && currencyValue.trim().length > 0
      ? currencyValue.trim().toUpperCase()
      : null;
  if (currency && currency !== "USD") return null;
  return priceToCents(value);
}

function conditionFromText(value: unknown): NormalizedComp["condition"] {
  const text = (typeof value === "string" ? value : "").toLowerCase();
  if (text.includes("new with tag")) return "new_with_tags";
  if (text.includes("new")) return "new_without_tags";
  if (text.includes("excellent")) return "used_excellent";
  if (text.includes("pre-owned") || text.includes("preowned") || text.includes("used")) {
    return "used_good";
  }
  return "unknown";
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function httpUrl(value: unknown): string | null {
  const str = firstString(value);
  return str && /^https?:\/\//i.test(str) ? str : null;
}

export function mapApifyEbaySoldItems(items: unknown[], query: CompQuery): NormalizedComp[] {
  const out: NormalizedComp[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;

    const title = firstString(item.title, item.name);
    if (!title) continue;

    const priceCents = priceToUsdCents(
      item.soldPrice ?? item.price ?? item.priceWithCurrency,
      item.soldCurrency ?? item.currency,
    );
    if (priceCents == null) continue;

    const shippingCents =
      priceToUsdCents(
        item.shippingPrice ?? item.shipping ?? item.shippingCost,
        item.shippingCurrency ?? item.currency,
      ) ?? 0;

    out.push({
      source: SOURCE_ID,
      externalId: firstString(item.id, item.itemId, item.epid),
      title: title.slice(0, 200),
      priceCents,
      shippingCents,
      currency: "USD",
      soldDate: isoDate(
        item.soldDate ?? item.dateSold ?? item.endDate ?? item.endTime ?? item.endedAt,
      ),
      url: httpUrl(item.url ?? item.itemUrl ?? item.link),
      imageUrl: httpUrl(
        item.image ?? item.imageUrl ?? item.thumbnail ?? item.thumbnailUrl ?? item.galleryURL,
      ),
      sold: true,
      condition: conditionFromText(item.condition),
      brand: firstString(item.brand) ?? query.brand ?? null,
      size: firstString(item.size) ?? query.size ?? null,
      category: query.category,
      rawJson: raw,
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export function createApifyEbaySoldSource(deps: ApifyEbaySoldDeps = {}): SoldCompSource {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    id: SOURCE_ID,
    displayName: "eBay sold (Apify)",
    sold: true,
    resultKind: "sold_comps",

    isEnabled() {
      return isApifyEbaySoldEnabled(env);
    },

    async fetchComps(query: CompQuery): Promise<NormalizedComp[]> {
      if (!isApifyEbaySoldEnabled(env)) return [];
      const token = env.APIFY_TOKEN;
      const actor = env.APIFY_EBAY_SOLD_ACTOR?.trim();
      if (!token || !actor) return [];

      const keywords = query.variants?.[0]?.keywords ?? query.keywords;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(actorEndpoint(actor), {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            keywords: [keywords],
            searchTerms: [keywords],
            maxItems: MAX_ITEMS,
            soldItems: true,
            ebayDomain: "ebay.com",
          }),
        });
        if (!response.ok) return [];
        const json = (await response.json()) as unknown;
        const items = Array.isArray(json)
          ? json
          : Array.isArray((json as { items?: unknown[] })?.items)
            ? (json as { items: unknown[] }).items
            : [];
        return mapApifyEbaySoldItems(items, query);
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export const apifyEbaySoldSource: SoldCompSource = createApifyEbaySoldSource();
