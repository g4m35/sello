import type { Flaw, Measurement } from "@/lib/ai/listing-draft";
import type { EbayPreflightResult } from "@/lib/marketplace/adapters/ebay/preflight";
import type {
  AttemptView,
  ChannelView,
  EbayOrphanArtifactView,
  ItemDetailView,
  ItemView,
} from "@/lib/view/types";

export type ApiError = { error: string; status: number };

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

export type CompsSummary = {
  status: string;
  totalComps: number;
  validComps: number;
  soldCompCount?: number;
  activeCompCount?: number;
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

async function request<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init?.headers ?? {}),
    },
  });

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

export const api = {
  listItems: (token: string) =>
    request<{ items: ItemView[] }>("/api/listings", token),

  getItem: (token: string, id: string) =>
    request<{ item: ItemDetailView }>(`/api/listings/${id}`, token),

  getHistory: (token: string) =>
    request<{ attempts: AttemptView[] }>("/api/history", token),

  deleteItems: (token: string, ids: string[]) =>
    request<{ deleted: number }>("/api/listings", token, {
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
        enabledSources: string[];
        queries: string[];
        sourceErrors: { source: string; message: string }[];
        lastRunAt: string | null;
        acceptedCount?: number | null;
        rejectedCount?: number | null;
      };
    }>(`/api/listings/comps?inventoryItemId=${encodeURIComponent(itemId)}`, token),

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
    request<{ ok: true }>(`/api/listings/${itemId}`, token, {
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
    request<{ draft: unknown }>(`/api/listings/draft/${draftId}`, token, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

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

  draftAction: (token: string, draftId: string, action: "reset" | "duplicate") =>
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
    marketplace: "depop" | "poshmark" | "grailed",
  ) =>
    request<{
      marketplace: "depop" | "poshmark" | "grailed";
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
