import { EtsyIntegrationError, etsyErrorCodes } from "./errors";
import type { EtsyConfig } from "./types";

// Thin authenticated wrapper over the Etsy Open API v3. Every request carries the
// app's x-api-key and the seller's Bearer token; neither is ever logged or
// returned to the UI. All non-2xx responses map to a sanitized EtsyIntegrationError
// (no raw Etsy payloads, tokens, or stack traces leak out).

export type EtsyClient = ReturnType<typeof createEtsyClient>;

export type EtsyMeResponse = { user_id: number; shop_id?: number | null };
export type EtsyShop = { shop_id: number; shop_name?: string };
export type EtsyShippingProfile = { shipping_profile_id: number; title?: string };
export type EtsyListing = {
  listing_id: number;
  state?: string;
  url?: string;
  quantity?: number;
};
export type EtsyListImagesUpload = {
  data: Uint8Array | Blob;
  fileName: string;
  rank?: number;
};

export function createEtsyClient(args: {
  config: EtsyConfig;
  accessToken: string;
  fetchImpl?: typeof fetch;
}) {
  const { config, accessToken } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  const baseUrl = config.apiBaseUrl.replace(/\/+$/, "");

  async function request<T>(
    path: string,
    init: RequestInit & { rawBody?: boolean } = {},
  ): Promise<T> {
    const { rawBody, headers, ...rest } = init;
    const finalHeaders: Record<string, string> = {
      "x-api-key": config.clientId,
      Authorization: `Bearer ${accessToken}`,
      ...(headers as Record<string, string> | undefined),
    };
    if (rest.body !== undefined && !rawBody) {
      finalHeaders["Content-Type"] = "application/json";
    }

    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...rest,
      headers: finalHeaders,
    });

    if (!response.ok) {
      throw mapResponseError(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  return {
    getMe: () => request<EtsyMeResponse>("/users/me"),
    getShop: (shopId: number | string) => request<EtsyShop>(`/shops/${shopId}`),
    getShopShippingProfiles: (shopId: number | string) =>
      request<{ results: EtsyShippingProfile[] }>(
        `/shops/${shopId}/shipping-profiles`,
      ),
    getSellerTaxonomyNodes: () =>
      request<{ results: { id: number; name: string }[] }>(
        "/seller-taxonomy/nodes",
      ),
    getListing: (listingId: number | string) =>
      request<EtsyListing>(`/listings/${listingId}`),
    getShopReceipts: (shopId: number | string) =>
      request<{ results: unknown[] }>(`/shops/${shopId}/receipts`),

    createDraftListing: (shopId: number | string, body: Record<string, unknown>) =>
      request<EtsyListing>(`/shops/${shopId}/listings`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    updateListing: (
      shopId: number | string,
      listingId: number | string,
      body: Record<string, unknown>,
    ) =>
      request<EtsyListing>(`/shops/${shopId}/listings/${listingId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    updateListingInventory: (
      listingId: number | string,
      body: Record<string, unknown>,
    ) =>
      request<unknown>(`/listings/${listingId}/inventory`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    // Publish = move a draft to active; deactivate (end) = move to inactive. Etsy
    // models both as a listing state change, not a separate verb.
    activateListing: (shopId: number | string, listingId: number | string) =>
      request<EtsyListing>(`/shops/${shopId}/listings/${listingId}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "active" }),
      }),
    deactivateListing: (shopId: number | string, listingId: number | string) =>
      request<EtsyListing>(`/shops/${shopId}/listings/${listingId}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "inactive" }),
      }),
    deleteListing: (listingId: number | string) =>
      request<void>(`/listings/${listingId}`, { method: "DELETE" }),

    uploadListingImage: (
      shopId: number | string,
      listingId: number | string,
      image: EtsyListImagesUpload,
    ) => {
      const form = new FormData();
      const blob =
        image.data instanceof Blob
          ? image.data
          : new Blob([image.data as unknown as BlobPart]);
      form.append("image", blob, image.fileName);
      if (typeof image.rank === "number") {
        form.append("rank", String(image.rank));
      }
      return request<{ listing_image_id: number }>(
        `/shops/${shopId}/listings/${listingId}/images`,
        { method: "POST", body: form, rawBody: true },
      );
    },
  };
}

// Maps HTTP status to a safe error code. The response body is intentionally not
// read or surfaced, so raw Etsy/provider/token content can never reach the client.
export function mapResponseError(response: {
  status: number;
  headers?: { get(name: string): string | null };
}): EtsyIntegrationError {
  const status = response.status;

  if (status === 401) {
    return new EtsyIntegrationError(
      etsyErrorCodes.reconnectRequired,
      "Your Etsy connection has expired. Reconnect Etsy.",
      401,
    );
  }
  if (status === 403) {
    return new EtsyIntegrationError(
      etsyErrorCodes.scopeMissing,
      "Etsy denied this request. Reconnect Etsy and grant the required permissions.",
      403,
    );
  }
  if (status === 429) {
    const retryAfter = Number(response.headers?.get("retry-after"));
    return new EtsyIntegrationError(
      etsyErrorCodes.rateLimited,
      "Etsy is rate limiting requests. Try again shortly.",
      429,
      Number.isFinite(retryAfter) && retryAfter > 0
        ? { retryAfterSeconds: retryAfter }
        : undefined,
    );
  }
  if (status >= 500) {
    return new EtsyIntegrationError(
      etsyErrorCodes.apiFailed,
      "Etsy is temporarily unavailable. Try again shortly.",
      502,
      { status },
    );
  }
  return new EtsyIntegrationError(
    etsyErrorCodes.apiFailed,
    "Etsy request failed.",
    502,
    { status },
  );
}
