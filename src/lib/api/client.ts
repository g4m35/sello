import type {
  AttemptView,
  ChannelView,
  ItemDetailView,
  ItemView,
} from "@/lib/view/types";

export type ApiError = { error: string; status: number };

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
    const err: ApiError = {
      error: json?.error ?? `Request failed (${res.status})`,
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
      comps: unknown[];
      summary: {
        status: string;
        totalComps: number;
        validComps: number;
        lowCents: number | null;
        averageCents: number | null;
        highCents: number | null;
        quickSaleCents: number | null;
        recommendedListCents: number | null;
        confidence: string;
      };
    }>(`/api/listings/comps?inventoryItemId=${encodeURIComponent(itemId)}`, token),

  refreshComps: (token: string, inventoryItemId: string) =>
    request<{ fetched: number; sources: string[]; enabled: number }>(
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

  // Honest publish: the server returns 501 NOT_IMPLEMENTED. We surface the
  // outcome rather than treating it as an error toast.
  publish: async (
    token: string,
    body: { inventoryItemId: string; marketplace: string },
  ): Promise<{
    status: string;
    code: string;
    marketplace: string;
    reason: string;
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
    throw { error: json?.error ?? "Publish failed", status: res.status } as ApiError;
  },
};
