import { StockXIntegrationError, stockxErrorCodes } from "./errors";
import type {
  StockXCatalogCandidate,
  StockXConfig,
  StockXMarketDataPoint,
} from "./types";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  accessToken: string;
  query?: Record<string, string | null | undefined>;
  body?: unknown;
  failureCode?:
    | typeof stockxErrorCodes.catalogSearchFailed
    | typeof stockxErrorCodes.marketDataFailed
    | typeof stockxErrorCodes.apiFailed;
};

type CatalogSearchInput = {
  query: string;
  brand?: string | null;
  category?: string | null;
  size?: string | null;
};

export async function searchStockXCatalog(
  config: StockXConfig,
  accessToken: string,
  input: CatalogSearchInput,
  fetchImpl: typeof fetch = fetch,
): Promise<StockXCatalogCandidate[]> {
  const json = await stockxApiRequest(config, "/catalog/search", fetchImpl, {
    accessToken,
    query: {
      q: input.query,
      brand: input.brand,
      category: input.category,
      size: input.size,
    },
    failureCode: stockxErrorCodes.catalogSearchFailed,
  });

  return normalizeCatalogCandidates(json);
}

export async function fetchStockXMarketData(
  config: StockXConfig,
  accessToken: string,
  args: { productId: string; variantId?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<StockXMarketDataPoint[]> {
  const productId = encodeURIComponent(args.productId);
  const variantId = args.variantId ? encodeURIComponent(args.variantId) : null;
  const path = variantId
    ? `/catalog/products/${productId}/variants/${variantId}/market-data`
    : `/catalog/products/${productId}/market-data`;
  const json = await stockxApiRequest(config, path, fetchImpl, {
    accessToken,
    failureCode: stockxErrorCodes.marketDataFailed,
  });

  return normalizeMarketData(json, args);
}

async function stockxApiRequest(
  config: StockXConfig,
  path: string,
  fetchImpl: typeof fetch,
  options: RequestOptions,
): Promise<unknown> {
  const method = options.method ?? "GET";
  const url = new URL(path.replace(/^\//, ""), ensureTrailingSlash(config.apiBaseUrl));
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value && value.trim()) url.searchParams.set(key, value.trim());
  }

  const init: RequestInit = {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${options.accessToken}`,
      ...(config.apiKey ? { "x-api-key": config.apiKey } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  };

  const attempts = method === "GET" ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetchImpl(url, init);
    if (response.ok) return safeJson(response);

    const retryable = response.status === 429 || response.status >= 500;
    if (attempt + 1 < attempts && retryable) continue;

    throw new StockXIntegrationError(
      options.failureCode ?? stockxErrorCodes.apiFailed,
      "StockX API request failed.",
      response.status === 401 || response.status === 403 ? 503 : 502,
      { status: response.status },
    );
  }

  throw new StockXIntegrationError(
    options.failureCode ?? stockxErrorCodes.apiFailed,
    "StockX API request failed.",
    502,
  );
}

function normalizeCatalogCandidates(json: unknown): StockXCatalogCandidate[] {
  const roots = extractArray(json, ["products", "results", "data", "items"]);
  const candidates: StockXCatalogCandidate[] = [];

  for (const root of roots) {
    const product = asRecord(root);
    if (!product) continue;
    const productId = firstString(product, ["id", "productId", "uuid", "stockxId"]);
    const title = firstString(product, ["title", "name", "productName"]);
    if (!productId || !title) continue;

    const variants = extractArray(product, ["variants", "children", "sizes"]);
    if (variants.length === 0) {
      candidates.push(candidateFrom(product, null, productId, title));
      continue;
    }

    for (const rawVariant of variants) {
      const variant = asRecord(rawVariant);
      if (!variant) continue;
      candidates.push(candidateFrom(product, variant, productId, title));
    }
  }

  return dedupeCandidates(candidates).slice(0, 12);
}

function candidateFrom(
  product: Record<string, unknown>,
  variant: Record<string, unknown> | null,
  productId: string,
  title: string,
): StockXCatalogCandidate {
  return {
    productId,
    variantId: variant ? firstString(variant, ["id", "variantId", "uuid", "stockxId"]) : null,
    title,
    brand: firstString(product, ["brand", "brandName"]),
    model: firstString(product, ["model"]),
    style: firstString(product, ["style", "styleId", "styleCode", "sku"]),
    colorway: firstString(product, ["colorway"]),
    color:
      firstString(variant ?? {}, ["color", "colorway"]) ??
      firstString(product, ["color", "primaryColor"]),
    size: variant
      ? firstString(variant, ["size", "sizeLabel", "displaySize", "shoeSize"])
      : firstString(product, ["size"]),
    image: imageOf(product),
    category: firstString(product, ["category", "productCategory", "primaryCategory"]),
    url: urlOf(product),
  };
}

function normalizeMarketData(
  json: unknown,
  args: { productId: string; variantId?: string | null },
): StockXMarketDataPoint[] {
  const root = asRecord(json) ?? {};
  const data = asRecord(root.data) ?? root;
  const rows = [
    ...extractArray(data, ["sales", "recentSales", "lastSales", "transactions"]),
    ...[data.lastSale, data.lastSold, data.latestSale].filter(Boolean),
  ];

  const points: StockXMarketDataPoint[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const priceCents = priceCentsOf(record);
    if (!priceCents) continue;
    points.push({
      externalId:
        firstString(record, ["id", "saleId", "transactionId"]) ??
        `${args.productId}:${args.variantId ?? "product"}:${priceCents}`,
      title:
        firstString(record, ["title", "productName", "name"]) ??
        firstString(data, ["title", "productName", "name"]) ??
        "StockX market data",
      priceCents,
      currency: firstString(record, ["currency", "currencyCode"]) ?? "USD",
      soldDate: firstString(record, ["soldAt", "soldDate", "date", "createdAt"]),
      url: firstString(record, ["url", "permalink"]) ?? urlOf(data),
      imageUrl: imageOf(record) ?? imageOf(data),
      brand: firstString(record, ["brand", "brandName"]) ?? firstString(data, ["brand"]),
      size: firstString(record, ["size", "sizeLabel"]) ?? firstString(data, ["size"]),
      category:
        firstString(record, ["category", "productCategory"]) ??
        firstString(data, ["category", "productCategory"]),
      rawJson: row,
    });
  }

  return points.slice(0, 12);
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new StockXIntegrationError(
      stockxErrorCodes.apiFailed,
      "StockX returned an invalid response.",
      502,
    );
  }
}

function extractArray(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of keys) {
    const child = record[key];
    if (Array.isArray(child)) return child;
    const nested = asRecord(child);
    if (nested) {
      const nestedArray = extractArray(nested, keys);
      if (nestedArray.length > 0) return nestedArray;
    }
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function imageOf(record: Record<string, unknown>): string | null {
  const direct = firstString(record, ["image", "imageUrl", "thumbnail", "thumbUrl"]);
  if (direct) return direct;
  const media = asRecord(record.media);
  if (media) {
    const mediaDirect = firstString(media, ["imageUrl", "smallImageUrl", "thumbUrl"]);
    if (mediaDirect) return mediaDirect;
    const gallery = extractArray(media, ["gallery", "images"]);
    const first = gallery[0];
    if (typeof first === "string" && first.trim()) return first.trim();
    const firstRecord = asRecord(first);
    if (firstRecord) return firstString(firstRecord, ["url", "imageUrl"]);
  }
  return null;
}

function urlOf(record: Record<string, unknown>): string | null {
  const direct = firstString(record, ["url", "permalink"]);
  if (direct) return direct;
  const slug = firstString(record, ["slug"]);
  return slug ? `https://stockx.com/${slug}` : null;
}

function priceCentsOf(record: Record<string, unknown>): number | null {
  const cents = numberOf(record, [
    "priceCents",
    "amountCents",
    "salePriceCents",
    "lastSaleCents",
  ]);
  if (cents != null) return Math.round(cents);

  const dollars = numberOf(record, ["price", "amount", "salePrice", "lastSale"]);
  if (dollars != null) return Math.round(dollars * 100);

  const amount = asRecord(record.amount);
  if (amount) {
    const amountValue = numberOf(amount, ["amount", "value"]);
    if (amountValue != null) return Math.round(amountValue * 100);
  }

  return null;
}

function numberOf(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace(/[$,]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function dedupeCandidates(candidates: StockXCatalogCandidate[]): StockXCatalogCandidate[] {
  const seen = new Set<string>();
  const out: StockXCatalogCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.productId}:${candidate.variantId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}
