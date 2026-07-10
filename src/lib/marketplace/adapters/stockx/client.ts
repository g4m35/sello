import { StockXIntegrationError, stockxErrorCodes } from "./errors";
import type {
  StockXActivateListingResult,
  StockXCatalogCandidate,
  StockXConfig,
  StockXCreateListingResult,
  StockXDeactivateListingResult,
  StockXListingStatusResult,
  StockXMarketDataPoint,
} from "./types";
import type { StockXCreateListingPayload } from "./mapper";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  accessToken: string;
  query?: Record<string, string | null | undefined>;
  body?: unknown;
  failureCode?:
    | typeof stockxErrorCodes.catalogSearchFailed
    | typeof stockxErrorCodes.marketDataFailed
    | typeof stockxErrorCodes.listingFailed
    | typeof stockxErrorCodes.delistFailed
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
      query: input.query,
      pageNumber: "1",
      pageSize: "5",
    },
    failureCode: stockxErrorCodes.catalogSearchFailed,
  });

  const candidates = normalizeCatalogCandidates(json);
  const hasVariantMatches = candidates.some((candidate) => candidate.variantId);
  const enriched =
    hasVariantMatches || candidates.length === 0
      ? candidates
      : await enrichCatalogCandidatesWithVariants(config, accessToken, candidates, fetchImpl);

  return filterCatalogCandidates(enriched, input);
}

export async function fetchStockXMarketData(
  config: StockXConfig,
  accessToken: string,
  args: { productId: string; variantId?: string | null; currencyCode?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<StockXMarketDataPoint[]> {
  // StockX product/variant ids are UUIDs — keep them raw in the path (same as
  // catalog search). Over-encoding has caused partner APIs to 400.
  const productId = args.productId.trim();
  const variantId = args.variantId?.trim() || null;
  const currencyCode = (args.currencyCode ?? "USD").trim().toUpperCase() || "USD";
  const query = { currencyCode };

  // Prefer variant market-data when we have a size match; fall back to the
  // product-level endpoint (all variants) if StockX rejects the variant call.
  const paths = variantId
    ? [
        `/catalog/products/${productId}/variants/${variantId}/market-data`,
        `/catalog/products/${productId}/market-data`,
      ]
    : [`/catalog/products/${productId}/market-data`];

  let lastError: unknown;
  for (const path of paths) {
    try {
      const json = await stockxApiRequest(config, path, fetchImpl, {
        accessToken,
        query,
        failureCode: stockxErrorCodes.marketDataFailed,
      });
      const points = normalizeMarketData(json, { ...args, currencyCode });
      if (points.length > 0 || path === paths[paths.length - 1]) {
        return filterMarketDataForVariant(points, variantId);
      }
    } catch (error) {
      lastError = error;
      const status =
        error instanceof StockXIntegrationError &&
        typeof error.details?.status === "number"
          ? error.details.status
          : null;
      // Only fall through on client errors; auth/server failures should surface.
      if (status == null || status < 400 || status >= 500) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new StockXIntegrationError(
        stockxErrorCodes.marketDataFailed,
        "StockX API request failed.",
        502,
      );
}

function filterMarketDataForVariant(
  points: StockXMarketDataPoint[],
  variantId?: string | null,
): StockXMarketDataPoint[] {
  if (!variantId) return points;
  const matched = points.filter((point) => {
    const raw = asRecord(point.rawJson);
    if (!raw) return true;
    const rowVariant = firstString(raw, ["variantId", "variant_id"]);
    return !rowVariant || rowVariant === variantId;
  });
  return matched.length > 0 ? matched : points;
}

export async function createStockXListing(
  config: StockXConfig,
  accessToken: string,
  payload: StockXCreateListingPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<StockXCreateListingResult> {
  const json = await stockxApiRequest(config, "/selling/listings", fetchImpl, {
    method: "POST",
    accessToken,
    body: payload,
    failureCode: stockxErrorCodes.listingFailed,
  });

  return normalizeListingResult(json);
}

export async function activateStockXListing(
  config: StockXConfig,
  accessToken: string,
  listingId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StockXActivateListingResult> {
  const encodedListingId = encodeURIComponent(listingId);
  const json = await stockxApiRequest(
    config,
    `/selling/listings/${encodedListingId}/activate`,
    fetchImpl,
    {
      method: "PUT",
      accessToken,
      failureCode: stockxErrorCodes.listingFailed,
    },
  );

  return normalizeListingResult(json, listingId);
}

export async function deactivateStockXListing(
  config: StockXConfig,
  accessToken: string,
  listingId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StockXDeactivateListingResult> {
  const encodedListingId = encodeURIComponent(listingId);
  const json = await stockxApiRequest(
    config,
    `/selling/listings/${encodedListingId}/deactivate`,
    fetchImpl,
    {
      method: "PUT",
      accessToken,
      failureCode: stockxErrorCodes.delistFailed,
    },
  );

  return normalizeListingResult(json, listingId);
}

export async function deleteStockXListing(
  config: StockXConfig,
  accessToken: string,
  listingId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StockXDeactivateListingResult> {
  const encodedListingId = encodeURIComponent(listingId);
  const json = await stockxApiRequest(
    config,
    `/selling/listings/${encodedListingId}`,
    fetchImpl,
    {
      method: "DELETE",
      accessToken,
      failureCode: stockxErrorCodes.delistFailed,
    },
  );

  return normalizeListingResult(json, listingId);
}

export async function fetchStockXListingStatus(
  config: StockXConfig,
  accessToken: string,
  listingId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StockXListingStatusResult> {
  const encodedListingId = encodeURIComponent(listingId);
  const json = await stockxApiRequest(
    config,
    `/selling/listings/${encodedListingId}`,
    fetchImpl,
    {
      accessToken,
      failureCode: stockxErrorCodes.apiFailed,
    },
  );

  return normalizeListingResult(json, listingId);
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

    // Log a short scrubbed body server-side only — never attach raw upstream
    // bodies to StockXIntegrationError (those payloads can reach API clients).
    const bodySnippet = await safeErrorBodySnippet(response);
    if (bodySnippet) {
      console.error(
        `[stockx_api] ${options.failureCode ?? stockxErrorCodes.apiFailed} status=${response.status} path=${path} body=${bodySnippet}`,
      );
    }
    if (isStockXSellerProfileIncomplete(bodySnippet)) {
      throw new StockXIntegrationError(
        stockxErrorCodes.sellerProfileIncomplete,
        "Finish billing and shipping setup on StockX before using market data.",
        409,
        { status: response.status, path },
      );
    }
    throw new StockXIntegrationError(
      options.failureCode ?? stockxErrorCodes.apiFailed,
      "StockX API request failed.",
      response.status === 401 || response.status === 403 ? 503 : 502,
      { status: response.status, path },
    );
  }

  throw new StockXIntegrationError(
    options.failureCode ?? stockxErrorCodes.apiFailed,
    "StockX API request failed.",
    502,
  );
}

function isStockXSellerProfileIncomplete(bodySnippet: string | null): boolean {
  if (!bodySnippet) return false;
  const lower = bodySnippet.toLowerCase();
  return (
    lower.includes("billing") &&
    (lower.includes("shipping") || lower.includes("setup valid"))
  );
}

async function safeErrorBodySnippet(response: Response): Promise<string | null> {
  try {
    const text = (await response.text()).trim();
    if (!text) return null;
    // Prefer structured StockX error codes/messages when present.
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const code = typeof json.code === "string" ? json.code : null;
      const message =
        typeof json.message === "string"
          ? json.message
          : typeof json.errorMessage === "string"
            ? json.errorMessage
            : typeof json.error === "string"
              ? json.error
              : null;
      const parts = [code, message].filter(Boolean);
      if (parts.length > 0) return parts.join(": ").slice(0, 240);
    } catch {
      // not JSON
    }
    const scrubbed = text
      .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "[redacted]")
      .replace(
        /["']?(?:access_token|refresh_token|api[_-]?key|secret)["']?\s*[:=]\s*["'][^"']+["']/gi,
        "[redacted]",
      )
      .replace(/\bsecret\b/gi, "[redacted]");
    return scrubbed.slice(0, 240);
  } catch {
    return null;
  }
}

function normalizeCatalogCandidates(json: unknown): StockXCatalogCandidate[] {
  const roots = catalogProductRoots(json);
  const candidates: StockXCatalogCandidate[] = [];

  for (const root of roots) {
    const product = asRecord(root);
    if (!product) continue;
    const productId = firstString(product, ["productId", "id", "uuid", "stockxId"]);
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

  return dedupeCandidates(candidates);
}

async function enrichCatalogCandidatesWithVariants(
  config: StockXConfig,
  accessToken: string,
  candidates: StockXCatalogCandidate[],
  fetchImpl: typeof fetch,
): Promise<StockXCatalogCandidate[]> {
  const enriched: StockXCatalogCandidate[] = [];
  for (const candidate of candidates.slice(0, 5)) {
    const json = await stockxApiRequest(
      config,
      `/catalog/products/${encodeURIComponent(candidate.productId)}/variants`,
      fetchImpl,
      {
        accessToken,
        failureCode: stockxErrorCodes.catalogSearchFailed,
      },
    );
    enriched.push(...candidatesFromVariantResponse(candidate, json));
  }
  return enriched.length > 0 ? dedupeCandidates(enriched) : candidates;
}

function candidatesFromVariantResponse(
  candidate: StockXCatalogCandidate,
  json: unknown,
): StockXCatalogCandidate[] {
  const variants = catalogVariantRoots(json);
  return variants
    .map((rawVariant) => asRecord(rawVariant))
    .filter((variant): variant is Record<string, unknown> => Boolean(variant))
    .map((variant) =>
      candidateFrom(
        {
          productId: candidate.productId,
          title: candidate.title,
          brand: candidate.brand,
          model: candidate.model,
          style: candidate.style,
          colorway: candidate.colorway,
          color: candidate.color,
          image: candidate.image,
          category: candidate.category,
          url: candidate.url,
        },
        variant,
        candidate.productId,
        candidate.title,
      ),
    );
}

function filterCatalogCandidates(
  candidates: StockXCatalogCandidate[],
  input: CatalogSearchInput,
): StockXCatalogCandidate[] {
  const filtered = candidates.filter((candidate) => {
    if (input.brand && candidate.brand) {
      if (candidate.brand.toLowerCase() !== input.brand.toLowerCase()) return false;
    }
    if (input.category && candidate.category) {
      if (!candidate.category.toLowerCase().includes(input.category.toLowerCase())) return false;
    }
    if (input.size && candidate.size) {
      if (candidate.size.toLowerCase() !== input.size.toLowerCase()) return false;
    }
    return true;
  });
  return (filtered.length > 0 ? filtered : candidates).slice(0, 12);
}

function catalogProductRoots(json: unknown): unknown[] {
  const roots = extractArray(json, ["products", "results", "items"]);
  if (roots.length > 0) return roots;

  const root = asRecord(json);
  if (!root) return [];
  const product = asRecord(root.product);
  if (product) return [product];

  const data = asRecord(root.data);
  if (!data) return looksLikeCatalogProduct(root) ? [root] : [];
  const dataProduct = asRecord(data.product);
  if (dataProduct) return [dataProduct];
  return looksLikeCatalogProduct(data) ? [data] : [];
}

function catalogVariantRoots(json: unknown): unknown[] {
  const variants = extractArray(json, ["variants", "results", "items"]);
  if (variants.length > 0) return variants;
  const root = asRecord(json);
  if (!root) return [];
  const data = asRecord(root.data);
  if (!data) return Array.isArray(root.data) ? root.data : [];
  return extractArray(data, ["variants", "results", "items"]);
}

function candidateFrom(
  product: Record<string, unknown>,
  variant: Record<string, unknown> | null,
  productId: string,
  title: string,
): StockXCatalogCandidate {
  return {
    productId,
    variantId: variant ? firstString(variant, ["variantId", "id", "uuid", "stockxId"]) : null,
    title,
    brand: firstString(product, ["brand", "brandName"]),
    model: firstString(product, ["model"]),
    style: firstString(product, ["style", "styleId", "styleCode", "sku"]),
    colorway:
      firstString(product, ["colorway"]) ??
      firstString(asRecord(product.productAttributes) ?? {}, ["colorway"]),
    color:
      firstString(variant ?? {}, ["color", "colorway"]) ??
      firstString(product, ["color", "primaryColor"]) ??
      firstString(asRecord(product.productAttributes) ?? {}, ["color"]),
    size: variant
      ? (firstString(variant, ["size", "sizeLabel", "displaySize", "shoeSize", "variantValue"]) ??
        firstString(asRecord(variant.traits) ?? {}, ["size"]) ??
        firstString(asRecord(variant.variantTraits) ?? {}, ["size"]))
      : firstString(product, ["size"]),
    image: imageOf(product),
    category: firstString(product, ["category", "productCategory", "primaryCategory"]),
    url: urlOf(product),
  };
}

function normalizeMarketData(
  json: unknown,
  args: { productId: string; variantId?: string | null; currencyCode?: string | null },
): StockXMarketDataPoint[] {
  const root = asRecord(json) ?? {};
  // Official StockX market-data is ask/bid levels (not a sales history).
  // Variant endpoint → one object; product endpoint → array of variant rows.
  // Also accept legacy sale-history shapes if StockX ever returns them.
  const payload = root.data !== undefined ? root.data : json;
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : asRecord(payload)
      ? [payload]
      : [];

  const points: StockXMarketDataPoint[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;

    const marketPoints = marketDataPointsFromRecord(record, args);
    points.push(...marketPoints);

    // Legacy sale-history fallback (tests + older response shapes).
    const sales = [
      ...extractArray(record, ["sales", "recentSales", "lastSales", "transactions"]),
      ...[record.lastSale, record.lastSold, record.latestSale].filter(Boolean),
    ];
    for (const sale of sales) {
      const saleRecord = asRecord(sale);
      if (!saleRecord) continue;
      const priceCents = priceCentsOf(saleRecord);
      if (!priceCents) continue;
      points.push({
        externalId:
          firstString(saleRecord, ["id", "saleId", "transactionId"]) ??
          `${args.productId}:${args.variantId ?? "product"}:sale:${priceCents}`,
        title:
          firstString(saleRecord, ["title", "productName", "name"]) ??
          firstString(record, ["title", "productName", "name"]) ??
          "StockX market data",
        priceCents,
        currency:
          firstString(saleRecord, ["currency", "currencyCode"]) ??
          firstString(record, ["currency", "currencyCode"]) ??
          args.currencyCode ??
          "USD",
        soldDate: firstString(saleRecord, ["soldAt", "soldDate", "date", "createdAt"]),
        url: firstString(saleRecord, ["url", "permalink"]) ?? urlOf(record),
        imageUrl: imageOf(saleRecord) ?? imageOf(record),
        brand:
          firstString(saleRecord, ["brand", "brandName"]) ??
          firstString(record, ["brand"]),
        size:
          firstString(saleRecord, ["size", "sizeLabel"]) ??
          firstString(record, ["size", "sizeLabel", "variantValue", "variantName"]),
        category:
          firstString(saleRecord, ["category", "productCategory"]) ??
          firstString(record, ["category", "productCategory"]),
        rawJson: sale,
      });
    }
  }

  return dedupeMarketDataPoints(points).slice(0, 12);
}

function marketDataPointsFromRecord(
  record: Record<string, unknown>,
  args: { productId: string; variantId?: string | null; currencyCode?: string | null },
): StockXMarketDataPoint[] {
  const currency =
    firstString(record, ["currencyCode", "currency"]) ?? args.currencyCode ?? "USD";
  const variantId =
    firstString(record, ["variantId", "variant_id"]) ?? args.variantId ?? null;
  const productId =
    firstString(record, ["productId", "product_id"]) ?? args.productId;
  const size = firstString(record, [
    "size",
    "sizeLabel",
    "variantValue",
    "variantName",
    "variant_value",
    "variant_name",
  ]);
  const title =
    firstString(record, ["title", "productName", "name"]) ?? "StockX market data";

  // Prefer tradeable ask levels; include bid as a secondary market signal.
  const levels: Array<{ key: string; amountKeys: string[] }> = [
    {
      key: "lowest_ask",
      amountKeys: [
        "lowestAskAmount",
        "lowest_ask_amount",
        "lowestAsk",
        "flexLowestAskAmount",
        "flex_lowest_ask_amount",
      ],
    },
    {
      key: "sell_faster",
      amountKeys: ["sellFasterAmount", "sell_faster_amount"],
    },
    {
      key: "earn_more",
      amountKeys: ["earnMoreAmount", "earn_more_amount"],
    },
    {
      key: "highest_bid",
      amountKeys: ["highestBidAmount", "highest_bid_amount", "highestBid"],
    },
  ];

  const points: StockXMarketDataPoint[] = [];
  for (const level of levels) {
    const dollars = numberOf(record, level.amountKeys);
    if (dollars == null || dollars <= 0) continue;
    const priceCents = Math.round(dollars * 100);
    points.push({
      externalId: `${productId}:${variantId ?? "product"}:${level.key}:${priceCents}`,
      title,
      priceCents,
      currency,
      soldDate: null,
      url: urlOf(record),
      imageUrl: imageOf(record),
      brand: firstString(record, ["brand", "brandName"]),
      size,
      category: firstString(record, ["category", "productCategory"]),
      rawJson: record,
    });
  }

  // Nested amount objects (e.g. { lowestAsk: { amount: 120 } }).
  if (points.length === 0) {
    for (const nestedKey of ["lowestAsk", "highestBid", "lastSale"]) {
      const nested = asRecord(record[nestedKey]);
      if (!nested) continue;
      const priceCents = priceCentsOf(nested) ?? priceCentsOf({ amount: nested.amount });
      if (!priceCents) continue;
      points.push({
        externalId: `${productId}:${variantId ?? "product"}:${nestedKey}:${priceCents}`,
        title,
        priceCents,
        currency: firstString(nested, ["currency", "currencyCode"]) ?? currency,
        soldDate: firstString(nested, ["soldAt", "soldDate", "date", "createdAt"]),
        url: urlOf(record),
        imageUrl: imageOf(record),
        brand: firstString(record, ["brand", "brandName"]),
        size,
        category: firstString(record, ["category", "productCategory"]),
        rawJson: record,
      });
    }
  }

  return points;
}

function dedupeMarketDataPoints(points: StockXMarketDataPoint[]): StockXMarketDataPoint[] {
  const seen = new Set<string>();
  const out: StockXMarketDataPoint[] = [];
  for (const point of points) {
    const key = point.externalId ?? `${point.priceCents}:${point.size ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(point);
  }
  return out;
}

function normalizeListingResult(
  json: unknown,
  fallbackListingId?: string,
): StockXCreateListingResult {
  const root = asRecord(json) ?? {};
  const data = asRecord(root.data) ?? root;
  const listing = asRecord(data.listing) ?? asRecord(data.item) ?? data;
  const listingId =
    firstString(listing, ["listingId", "id", "uuid"]) ??
    firstString(data, ["listingId", "id", "uuid"]) ??
    fallbackListingId;

  if (!listingId) {
    throw new StockXIntegrationError(
      stockxErrorCodes.listingFailed,
      "StockX listing response did not include a listing id.",
      502,
    );
  }

  return {
    listingId,
    status:
      firstString(listing, ["status", "state", "listingStatus"]) ??
      firstString(data, ["status", "state", "listingStatus"]),
    operationId:
      firstString(data, ["operationId", "operation_id"]) ??
      firstString(root, ["operationId"]),
    operationStatus:
      firstString(data, ["operationStatus", "operation_status"]) ??
      firstString(root, ["operationStatus"]),
    operationUrl:
      firstString(data, ["operationUrl", "url"]) ??
      firstString(root, ["operationUrl", "url"]),
    rawJson: json,
  };
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

function looksLikeCatalogProduct(record: Record<string, unknown>): boolean {
  return Boolean(
    firstString(record, ["productId", "id", "uuid", "stockxId"]) &&
      firstString(record, ["title", "name", "productName"]),
  );
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
  const slug = firstString(record, ["slug", "urlKey"]);
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
