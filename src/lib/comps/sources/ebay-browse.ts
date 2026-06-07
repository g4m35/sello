import type { CompQuery, CompSource, NormalizedComp } from "@/lib/comps/source";

// Interim comp source: eBay Browse API (active listings = asking prices, not
// sold). Gated on production Browse credentials. When eBay Marketplace Insights
// (sold comps) is approved, a sold source replaces this as the primary signal.
//
// Env: EBAY_BROWSE_CLIENT_ID, EBAY_BROWSE_CLIENT_SECRET, optional
// EBAY_BROWSE_MARKETPLACE_ID (default EBAY_US).

const OAUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

type EbayItemSummary = {
  itemId?: string;
  title?: string;
  price?: { value?: string; currency?: string };
  itemWebUrl?: string;
};

async function getAppToken(clientId: string, clientSecret: string): Promise<string | null> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string };
  return json.access_token ?? null;
}

export const ebayBrowseSource: CompSource = {
  id: "ebay-browse",
  displayName: "eBay (active listings)",
  sold: false,

  isEnabled() {
    return Boolean(process.env.EBAY_BROWSE_CLIENT_ID && process.env.EBAY_BROWSE_CLIENT_SECRET);
  },

  async fetchComps(query: CompQuery): Promise<NormalizedComp[]> {
    const clientId = process.env.EBAY_BROWSE_CLIENT_ID;
    const clientSecret = process.env.EBAY_BROWSE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return [];

    const token = await getAppToken(clientId, clientSecret);
    if (!token) return [];

    const marketplace = process.env.EBAY_BROWSE_MARKETPLACE_ID || "EBAY_US";
    const url = `${SEARCH_URL}?q=${encodeURIComponent(query.keywords)}&limit=25`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplace,
      },
    });
    if (!res.ok) return [];

    const json = (await res.json()) as { itemSummaries?: EbayItemSummary[] };
    const summaries = json.itemSummaries ?? [];

    return summaries.flatMap((s): NormalizedComp[] => {
      const raw = s.price?.value;
      const currency = s.price?.currency ?? "USD";
      if (!raw || currency !== "USD") return [];
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value) || value <= 0) return [];
      return [
        {
          source: "ebay-browse",
          externalId: s.itemId ?? null,
          title: s.title ?? query.title,
          priceCents: Math.round(value * 100),
          shippingCents: 0,
          soldDate: null,
          url: s.itemWebUrl ?? null,
          sold: false,
          condition: "unknown",
        },
      ];
    });
  },
};
