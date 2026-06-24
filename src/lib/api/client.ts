import type { Flaw, Measurement } from "@/lib/ai/listing-draft";
import type { FeatureAccess } from "@/lib/auth/feature-access";
import type {
  BulkExecutionResult,
  BulkPreflightResult,
} from "@/lib/marketplace/bulk-publish";
import type {
  BulkDelistExecutionResult,
  BulkDelistPreflightResult,
} from "@/lib/marketplace/bulk-delist";
import type { EbayPreflightResult } from "@/lib/marketplace/adapters/ebay/preflight";
import type { ExportMarketplace } from "@/lib/marketplace/export-formatters";
import type {
  AttemptView,
  ChannelView,
  EbayOrphanArtifactView,
  ItemDetailView,
  ItemView,
} from "@/lib/view/types";

export type ApiError = { error: string; status: number };

export type FeatureAccessResponse = {
  access: FeatureAccess;
  copy: Record<keyof FeatureAccess, string>;
};

export type PriceCompRow = {
  id: string;
  source: string;
  sourceType: string;
  platform: string | null;
  status: string;
  title: string;
  brand: string | null;
  size: string | null;
  priceCents: number;
  shippingCents: number;
  totalPriceCents: number | null;
  currency: string;
  soldDate: string | null;
  url: string | null;
  imageUrl: string | null;
  condition: string;
  matchScore: number | null;
  usedInPricing: boolean;
  ignoredAsOutlier: boolean;
  rawJson: unknown;
  notes: string | null;
};

export type FeedbackRow = {
  id: string;
  type: string;
  severity: string;
  marketplace: string | null;
  subject: string;
  status: string;
  createdAt: string;
};

export type AdminFeedbackRow = FeedbackRow & {
  userId: string;
  message: string;
  pageUrl: string | null;
  listingId: string | null;
  draftId: string | null;
  adminNotes: string | null;
  updatedAt: string;
};

export type ProviderUsageRow = {
  id: string;
  userId?: string;
  provider: string;
  status: string;
  skippedReason: string | null;
  estimatedCostCents: number;
  fetchedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  draftId: string | null;
  inventoryItemId: string | null;
  createdAt: string;
};

export type CompsSummary = {
  status: string;
  totalComps: number;
  validComps: number;
  soldCompCount?: number;
  activeCompCount?: number;
  unknownCompCount?: number;
  strongCompCount?: number;
  possibleCompCount?: number;
  pricingBasis?: string;
  confidenceCapReason?: string | null;
  lowCents: number | null;
  medianCents?: number | null;
  averageCents: number | null;
  highCents: number | null;
  quickSaleCents: number | null;
  recommendedListCents: number | null;
  confidence: string;
  confidenceScore?: number;
  confidenceReasons?: string[];
};

type RequestOptions = RequestInit & { timeoutMs?: number };
const READ_REQUEST_TIMEOUT_MS = 10_000;

async function request<T>(
  path: string,
  token: string,
  init?: RequestOptions,
): Promise<T> {
  const { timeoutMs, ...fetchInit } = init ?? {};
  const controller = timeoutMs ? new AbortController() : null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const fetchPromise = fetch(path, {
    ...fetchInit,
    signal: fetchInit.signal ?? controller?.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(fetchInit.body && !(fetchInit.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(fetchInit.headers ?? {}),
    },
  });

  const res = timeoutMs
    ? await Promise.race([
        fetchPromise,
        new Promise<Response>((_, reject) => {
          timeout = setTimeout(() => {
            controller?.abort();
            reject({
              error: "The request took too long. Please try again.",
              status: 408,
            } satisfies ApiError);
          }, timeoutMs);
        }),
      ]).finally(() => {
        if (timeout) clearTimeout(timeout);
      })
    : await fetchPromise;

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};

  if (!res.ok) {
    const message =
      typeof json?.error === "string"
        ? json.error
        : typeof json?.error?.message === "string"
          ? json.error.message
          : `Request failed (${res.status})`;
    const err: ApiError = {
      error: message,
      status: res.status,
    };
    throw err;
  }
  return json as T;
}

// Internal transport chunk size. The bulk endpoints accept a high configurable
// ceiling (default 1000); we split larger selections into request-sized chunks
// so a seller never hits a visible cap, then merge results in selected order.
// One logical bulkRunId is shared across all execution chunks for audit/sync.
const BULK_TRANSPORT_CHUNK = 500;

function chunkIds(ids: string[], size: number): string[][] {
  if (ids.length <= size) return [ids];
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

function mergeBulkPreflight(parts: BulkPreflightResult[]): BulkPreflightResult {
  const first = parts[0];
  return {
    livePublishAllowed: first.livePublishAllowed,
    alphaCopy: parts.find((p) => p.alphaCopy)?.alphaCopy,
    total: parts.reduce((n, p) => n + p.total, 0),
    readyCount: parts.reduce((n, p) => n + p.readyCount, 0),
    needsDetailsCount: parts.reduce((n, p) => n + p.needsDetailsCount, 0),
    skippedCount: parts.reduce((n, p) => n + p.skippedCount, 0),
    rejectedCount: parts.reduce((n, p) => n + p.rejectedCount, 0),
    items: parts.flatMap((p) => p.items),
  };
}

function mergeBulkExecution(
  parts: BulkExecutionResult[],
  bulkRunId: string,
): BulkExecutionResult {
  return {
    bulkRunId,
    total: parts.reduce((n, p) => n + p.total, 0),
    publishedCount: parts.reduce((n, p) => n + p.publishedCount, 0),
    skippedCount: parts.reduce((n, p) => n + p.skippedCount, 0),
    failedCount: parts.reduce((n, p) => n + p.failedCount, 0),
    needsDetailsCount: parts.reduce((n, p) => n + p.needsDetailsCount, 0),
    items: parts.flatMap((p) => p.items),
  };
}

function mergeBulkDelistPreflight(
  parts: BulkDelistPreflightResult[],
): BulkDelistPreflightResult {
  const first = parts[0];
  return {
    liveDelistAllowed: first.liveDelistAllowed,
    alphaCopy: parts.find((p) => p.alphaCopy)?.alphaCopy,
    total: parts.reduce((n, p) => n + p.total, 0),
    eligibleCount: parts.reduce((n, p) => n + p.eligibleCount, 0),
    notListedCount: parts.reduce((n, p) => n + p.notListedCount, 0),
    alreadyEndedCount: parts.reduce((n, p) => n + p.alreadyEndedCount, 0),
    inFlightCount: parts.reduce((n, p) => n + p.inFlightCount, 0),
    rejectedCount: parts.reduce((n, p) => n + p.rejectedCount, 0),
    items: parts.flatMap((p) => p.items),
  };
}

function mergeBulkDelistExecution(
  parts: BulkDelistExecutionResult[],
  bulkRunId: string,
): BulkDelistExecutionResult {
  return {
    bulkRunId,
    total: parts.reduce((n, p) => n + p.total, 0),
    endedCount: parts.reduce((n, p) => n + p.endedCount, 0),
    skippedCount: parts.reduce((n, p) => n + p.skippedCount, 0),
    failedCount: parts.reduce((n, p) => n + p.failedCount, 0),
    items: parts.flatMap((p) => p.items),
  };
}

export const api = {
  getFeatureAccess: (token: string) =>
    request<FeatureAccessResponse>("/api/capabilities", token, {
      timeoutMs: READ_REQUEST_TIMEOUT_MS,
    }),

  listItems: (token: string) =>
    request<{ items: ItemView[] }>("/api/listings", token),

  getItem: (token: string, id: string) =>
    request<{ item: ItemDetailView }>(`/api/listings/${id}`, token, {
      timeoutMs: READ_REQUEST_TIMEOUT_MS,
    }),

  getHistory: (token: string) =>
    request<{ attempts: AttemptView[] }>("/api/history", token),

  deleteItems: (token: string, ids: string[]) =>
    request<{
      deleted: string[];
      blocked: { itemId: string; reason: "LIVE_MARKETPLACE_LISTING" }[];
    }>("/api/listings", token, {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }),

  setBulkPrice: (token: string, ids: string[], priceCents: number) =>
    request<{ updated: number }>("/api/listings/price", token, {
      method: "POST",
      body: JSON.stringify({ ids, priceCents }),
    }),

  getComps: (token: string, itemId: string) =>
    request<{
      inventoryItemId: string | null;
      comps: PriceCompRow[];
      summary: CompsSummary;
      discovery: {
        status: string;
        autoDiscoveryEnabled: boolean;
        paidProvidersEnabled?: boolean;
        enabledSources: string[];
        queries: string[];
        sourceErrors: { source: string; message: string }[];
        lastRunAt: string | null;
        acceptedCount?: number | null;
        rejectedCount?: number | null;
        cooldownSecondsRemaining?: number;
      };
    }>(`/api/listings/comps?inventoryItemId=${encodeURIComponent(itemId)}`, token, {
      timeoutMs: READ_REQUEST_TIMEOUT_MS,
    }),

  addComp: (
    token: string,
    body: {
      inventoryItemId: string;
      comp: {
        source: string;
        sourceType: "manual" | "api" | "scraper" | "visual_search";
        platform?: string | null;
        status: "sold" | "active" | "unknown";
        title: string;
        brand?: string | null;
        size?: string | null;
        priceCents: number;
        shippingCents?: number;
        totalPriceCents?: number | null;
        currency?: string;
        soldDate?: string | null;
        url?: string | null;
        imageUrl?: string | null;
        condition?: string;
        matchScore?: number | null;
        usedInPricing?: boolean;
        ignoredAsOutlier?: boolean;
        rawJson?: unknown;
        notes?: string | null;
      };
    },
  ) =>
    request<{
      inventoryItemId: string;
      comps: PriceCompRow[];
      summary: CompsSummary;
    }>("/api/listings/comps", token, { method: "POST", body: JSON.stringify(body) }),

  updateComp: (
    token: string,
    compId: string,
    body: {
      usedInPricing?: boolean;
      ignoredAsOutlier?: boolean;
      notes?: string | null;
    },
  ) =>
    request<{
      inventoryItemId: string;
      comps: PriceCompRow[];
      summary: CompsSummary;
    }>(`/api/listings/comps/${compId}`, token, { method: "PATCH", body: JSON.stringify(body) }),

  deleteComp: (token: string, compId: string) =>
    request<{
      inventoryItemId: string;
      comps: PriceCompRow[];
      summary: CompsSummary;
    }>(`/api/listings/comps/${compId}`, token, { method: "DELETE" }),

  refreshComps: (token: string, inventoryItemId: string) =>
    request<{
      fetched: number;
      accepted: number;
      rejected: number;
      sources: string[];
      enabled: number;
      status: string;
      queries: string[];
      sourceErrors: { source: string; message: string }[];
      appliedPriceCents: number | null;
    }>(
      "/api/listings/comps/refresh",
      token,
      { method: "POST", body: JSON.stringify({ inventoryItemId }) },
    ),

  submitFeedback: (
    token: string,
    body: {
      type: string;
      severity: string;
      marketplace?: string | null;
      subject: string;
      message: string;
      pageUrl?: string | null;
      listingId?: string | null;
      draftId?: string | null;
    },
  ) =>
    request<{ ok: true; id: string }>("/api/feedback", token, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getMyFeedback: (token: string) =>
    request<{ rows: FeedbackRow[] }>("/api/feedback", token),

  getAdminFeedback: (token: string, query = "") =>
    request<{ rows: AdminFeedbackRow[]; openCount: number }>(
      `/api/admin/feedback${query}`,
      token,
    ),

  updateFeedback: (
    token: string,
    id: string,
    body: { status?: string; adminNotes?: string | null },
  ) =>
    request<{ ok: true; feedback: { id: string; status: string } }>(
      `/api/admin/feedback/${id}`,
      token,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  getAdminProviderUsage: (token: string) =>
    request<{
      paidProvidersEnabled: boolean;
      totals: {
        todaySpendCents: number;
        monthSpendCents: number;
        todayCalls: number;
        monthCalls: number;
        todaySkipped: number;
        todayFailures: number;
      };
      rows: ProviderUsageRow[];
    }>("/api/admin/provider-usage", token),

  getAdminMarketplaceOperations: (token: string) =>
    request<{
      access: { liveEbayPublish: string[]; ebayDelist: string[]; paidComps: string[] };
      attempts: {
        id: string;
        requestedBy: string;
        itemId: string;
        itemTitle: string;
        action: "publish" | "delist" | "cleanup";
        status: string;
        code: string;
        bulkRunId: string | null;
        externalListingId: string | null;
        createdAt: string;
      }[];
    }>("/api/admin/marketplace-operations", token),

  getChannels: async (token: string): Promise<ChannelView[]> => {
    const res = await request<{
      adapters: {
        marketplace: string;
        displayName: string;
        capabilities: { draftPreview: boolean; publish: boolean; inventorySync: boolean };
      }[];
    }>("/api/jobs", token);
    return res.adapters.map((a) => ({
      marketplace: a.marketplace,
      name: a.displayName,
      capabilities: a.capabilities,
      listedCount: 0,
    }));
  },

  // Create flow: upload photos -> Gemini identification -> draft.
  createDraftFromPhotos: (token: string, files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append("photos", file);
    return request<{ inventoryItem: { id: string }; draft: { id: string } }>(
      "/api/listings/draft",
      token,
      { method: "POST", body: form },
    );
  },

  addPhotos: (token: string, itemId: string, files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append("photos", file);
    return request<{ added: number }>(`/api/listings/${itemId}/photos`, token, {
      method: "POST",
      body: form,
    });
  },

  updateItem: (
    token: string,
    itemId: string,
    body: {
      productName?: string;
      brand?: string | null;
      category?: string;
      condition?: string;
      size?: string | null;
      colorway?: string | null;
      styleCode?: string | null;
    },
  ) =>
    request<{ ok: true; item: ItemDetailView | null }>(`/api/listings/${itemId}`, token, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  setCoverPhoto: (token: string, itemId: string, photoId: string) =>
    request<{ ok: true }>(`/api/listings/${itemId}/photos`, token, {
      method: "PATCH",
      body: JSON.stringify({ photoId }),
    }),

  deletePhoto: (token: string, itemId: string, photoId: string) =>
    request<{ deleted: number; remaining: number }>(
      `/api/listings/${itemId}/photos?photoId=${encodeURIComponent(photoId)}`,
      token,
      { method: "DELETE" },
    ),

  updateDraft: (
    token: string,
    draftId: string,
    body: {
      title?: string;
      description?: string;
      bulletPoints?: string[];
      recommendedPriceCents?: number | null;
      selectedMarketplaces?: string[];
      marketplaceDrafts?: {
        ebay?: { categoryId: string; quantity?: number; aspects?: Record<string, string> };
      };
      measurements?: Measurement[];
      flaws?: Flaw[];
      approve?: boolean;
    },
  ) =>
    request<{ draft: unknown; item: ItemDetailView | null }>(
      `/api/listings/draft/${draftId}`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    ),

  importRows: (
    token: string,
    rows: {
      title: string;
      brand?: string | null;
      size?: string | null;
      color?: string | null;
      condition?: string | null;
      category?: string | null;
      sku?: string | null;
      priceCents?: number | null;
    }[],
  ) =>
    request<{ created: number; ids: string[] }>("/api/listings/import", token, {
      method: "POST",
      body: JSON.stringify({ rows }),
    }),

  draftAction: (token: string, draftId: string, action: "reset" | "duplicate" | "approve") =>
    request<{ inventoryItem: { id: string }; draft: { id: string } }>(
      `/api/listings/draft/${draftId}`,
      token,
      { method: "POST", body: JSON.stringify({ action }) },
    ),

  lifecycle: (
    token: string,
    body: { inventoryItemId: string; action: "mark_sold" | "delist" },
  ) =>
    request<{ inventoryItem: unknown }>("/api/listings/lifecycle", token, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  delistEbay: (
    token: string,
    body: {
      inventoryItemId: string;
      marketplace: "ebay";
      confirmLiveDelist: true;
    },
  ) =>
    request<{
      ok: true;
      status: "delisted";
      code: string;
      marketplace: "ebay";
      environment: string;
      marketplaceListingId: string;
      publishAttemptId: string;
    }>("/api/listings/delist", token, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Read-only bulk publish dry run. Available to every seller; returns
  // livePublishAllowed:false plus alpha copy for non-allowlisted accounts.
  // Large selections are chunked internally and merged in selected order.
  preflightBulkPublish: async (
    token: string,
    itemIds: string[],
  ): Promise<BulkPreflightResult> => {
    const chunks = chunkIds(itemIds, BULK_TRANSPORT_CHUNK);
    const parts = await Promise.all(
      chunks.map((ids) =>
        request<BulkPreflightResult>("/api/listings/publish/bulk/preflight", token, {
          method: "POST",
          body: JSON.stringify({ itemIds: ids }),
        }),
      ),
    );
    return mergeBulkPreflight(parts);
  },

  // Live bulk publish. Requires the live-eBay alpha entitlement server-side and
  // explicit confirmation here. One bulkRunId ties every transport chunk
  // together; chunks run sequentially so eBay is never hammered in parallel.
  executeBulkPublish: async (
    token: string,
    itemIds: string[],
  ): Promise<BulkExecutionResult> => {
    const bulkRunId = globalThis.crypto.randomUUID();
    const chunks = chunkIds(itemIds, BULK_TRANSPORT_CHUNK);
    const parts: BulkExecutionResult[] = [];
    for (const ids of chunks) {
      parts.push(
        await request<BulkExecutionResult>("/api/listings/publish/bulk", token, {
          method: "POST",
          body: JSON.stringify({ itemIds: ids, bulkRunId, confirmLivePublish: true }),
        }),
      );
    }
    return mergeBulkExecution(parts, bulkRunId);
  },

  // Read-only bulk end/delist dry run. Available to every seller; classifies
  // which selected items have a live eBay listing that can be ended.
  preflightBulkDelist: async (
    token: string,
    itemIds: string[],
  ): Promise<BulkDelistPreflightResult> => {
    const chunks = chunkIds(itemIds, BULK_TRANSPORT_CHUNK);
    const parts = await Promise.all(
      chunks.map((ids) =>
        request<BulkDelistPreflightResult>("/api/listings/delist/bulk/preflight", token, {
          method: "POST",
          body: JSON.stringify({ itemIds: ids }),
        }),
      ),
    );
    return mergeBulkDelistPreflight(parts);
  },

  // Live bulk end/delist. Requires the eBay-delist alpha entitlement server-side
  // and explicit confirmation here. One bulkRunId ties every chunk together;
  // chunks run sequentially so eBay is never hammered in parallel.
  executeBulkDelist: async (
    token: string,
    itemIds: string[],
  ): Promise<BulkDelistExecutionResult> => {
    const bulkRunId = globalThis.crypto.randomUUID();
    const chunks = chunkIds(itemIds, BULK_TRANSPORT_CHUNK);
    const parts: BulkDelistExecutionResult[] = [];
    for (const ids of chunks) {
      parts.push(
        await request<BulkDelistExecutionResult>("/api/listings/delist/bulk", token, {
          method: "POST",
          body: JSON.stringify({ itemIds: ids, bulkRunId, confirmLiveDelist: true }),
        }),
      );
    }
    return mergeBulkDelistExecution(parts, bulkRunId);
  },

  scanEbayOrphans: (token: string, itemId: string) =>
    request<{ ok: true; scan: EbayOrphanArtifactView }>(
      `/api/listings/${itemId}/ebay-orphans`,
      token,
      { method: "POST", body: JSON.stringify({ action: "scan" }) },
    ),

  cleanupEbayOrphans: (token: string, itemId: string) =>
    request<{
      ok: true;
      status: "cleaned";
      code: string;
      marketplace: "ebay";
      environment: string;
      scan: EbayOrphanArtifactView;
      marketplaceListingId: string;
      publishAttemptId: string;
    }>(`/api/listings/${itemId}/ebay-orphans`, token, {
      method: "POST",
      body: JSON.stringify({ action: "cleanup", confirmCleanup: true }),
    }),

  // Copy/paste export text for marketplaces without a publish adapter. The
  // server only formats text; nothing is published.
  exportListing: (
    token: string,
    itemId: string,
    marketplace: ExportMarketplace,
  ) =>
    request<{
      marketplace: ExportMarketplace;
      title: string;
      body: string;
      warnings: string[];
    }>(
      `/api/listings/${itemId}/export?marketplace=${encodeURIComponent(marketplace)}`,
      token,
    ),

  // eBay publish preflight (dry run). Validates the listing and returns the
  // exact payload preview without any outbound eBay call. Used to drive the
  // final live-publish review so what the seller confirms equals what is sent.
  ebayPreflight: (token: string, itemId: string) =>
    request<EbayPreflightResult>(
      `/api/listings/${itemId}/ebay-preflight`,
      token,
      { method: "POST" },
    ),

  // Honest publish: the server returns 501 NOT_IMPLEMENTED. We surface the
  // outcome rather than treating it as an error toast.
  publish: async (
    token: string,
    body: { inventoryItemId: string; marketplace: string },
  ): Promise<{
    status: string;
    code: string;
    marketplace: string;
    reason?: string;
    message?: string;
  }> => {
    const res = await fetch("/api/listings/publish", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    // 501 is the expected, documented outcome — return it as data.
    if (res.status === 501 || res.ok) return json;
    throw {
      error:
        typeof json?.error === "string"
          ? json.error
          : typeof json?.error?.message === "string"
            ? json.error.message
            : "Publish failed",
      status: res.status,
    } as ApiError;
  },
};
