import { isEbayActiveEnabled } from "@/lib/comps/flags";
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
  image?: { imageUrl?: string };
  condition?: string;
  shippingOptions?: { shippingCost?: { value?: string; currency?: string } }[];
};

const DEFAULT_TIMEOUT_MS = 6_000;

function credentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.EBAY_BROWSE_CLIENT_ID || process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_BROWSE_CLIENT_SECRET || process.env.EBAY_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": "SelloPriceComps/1.0 (+https://sello.wtf)",
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function getAppToken(clientId: string, clientSecret: string): Promise<string | null> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetchWithTimeout(OAUTH_URL, {
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

function conditionFromEbay(value: string | undefined): NormalizedComp["condition"] {
  const normalized = (value ?? "").toLowerCase();
  if (normalized.includes("new")) return "new_without_tags";
  if (normalized.includes("pre-owned") || normalized.includes("used")) return "used_good";
  return "unknown";
}

function cents(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
}

export const ebayBrowseSource: CompSource = {
  id: "ebay-browse",
  displayName: "eBay Browse (active market listings)",
  sold: false,
  resultKind: "active_listings",

  isEnabled() {
    // Provider gate only: the COMPS_EBAY_ACTIVE_ENABLED flag (or legacy
    // PRICE_COMP_EBAY_SEARCH_ENABLED) plus Browse credentials. The global
    // auto-discovery kill switch is enforced centrally in runCompFetch.
    return isEbayActiveEnabled();
  },

  async fetchComps(query: CompQuery): Promise<NormalizedComp[]> {
    const creds = credentials();
    if (!creds) return [];

    const token = await getAppToken(creds.clientId, creds.clientSecret);
    if (!token) return [];

    const marketplace = process.env.EBAY_BROWSE_MARKETPLACE_ID || "EBAY_US";
    const keywords = query.variants?.[0]?.keywords ?? query.keywords;
    const url = `${SEARCH_URL}?q=${encodeURIComponent(keywords)}&limit=25`;
    const res = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplace,
      },
    });
    if (!res.ok) return [];

    const json = (await res.json()) as { itemSummaries?: EbayItemSummary[] };
    const summaries = json.itemSummaries ?? [];

    return summaries.flatMap((s): NormalizedComp[] => {
      const currency = s.price?.currency ?? "USD";
      if (currency !== "USD") return [];
      const priceCents = cents(s.price?.value);
      if (priceCents == null) return [];
      const shipping = s.shippingOptions?.find(
        (option) => (option.shippingCost?.currency ?? "USD") === "USD",
      )?.shippingCost?.value;
      return [
        {
          source: "ebay-browse",
          externalId: s.itemId ?? null,
          title: s.title ?? query.title,
          priceCents,
          shippingCents: cents(shipping) ?? 0,
          currency,
          soldDate: null,
          url: s.itemWebUrl ?? null,
          imageUrl: s.image?.imageUrl ?? null,
          sold: false,
          condition: conditionFromEbay(s.condition),
          rawJson: s,
        },
      ];
    });
  },
};
