import type { NormalizedComp } from "@/lib/comps/source";

// Dedupe by (source, externalId) when present, else (source, url, priceCents).
export function dedupeComps(comps: NormalizedComp[]): NormalizedComp[] {
  const seen = new Set<string>();
  const out: NormalizedComp[] = [];
  for (const c of comps) {
    const key = c.externalId
      ? `${c.source}:${c.externalId}`
      : `${c.source}:${c.url ?? ""}:${c.priceCents}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// Trim obvious outliers using an IQR fence so a single mispriced listing does
// not skew pricing. No-op for small samples.
export function trimOutliers(comps: NormalizedComp[]): NormalizedComp[] {
  if (comps.length < 4) return comps;
  const prices = comps.map((c) => c.priceCents).sort((a, b) => a - b);
  const q = (p: number) => prices[Math.floor((prices.length - 1) * p)];
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  return comps.filter((c) => c.priceCents >= lo && c.priceCents <= hi);
}

function isAccepted(c: NormalizedComp): boolean {
  return c.matchClassification === "strong" || c.matchClassification === "possible";
}

// Maps a normalized comp to PriceComp create data. The source is prefixed
// "auto:" so refreshed automatic comps can be replaced without touching any
// manually entered comps.
export function toPriceCompCreate(inventoryItemId: string, c: NormalizedComp) {
  const accepted = isAccepted(c);
  return {
    inventoryItemId,
    source: `auto:${c.source}`,
    sourceType: "api" as const,
    platform: c.source.includes("ebay") ? "ebay" : null,
    status: (c.sold ? "sold" : "active") as "sold" | "active",
    title: c.title.slice(0, 200),
    brand: c.brand?.slice(0, 80) ?? null,
    size: c.size?.slice(0, 40) ?? null,
    priceCents: c.priceCents,
    shippingCents: c.shippingCents,
    totalPriceCents: c.priceCents + c.shippingCents,
    currency: c.currency ?? "USD",
    soldDate: c.soldDate ? new Date(c.soldDate) : null,
    url: c.url && /^https?:\/\//i.test(c.url) ? c.url.slice(0, 500) : null,
    imageUrl:
      c.imageUrl && /^https?:\/\//i.test(c.imageUrl) ? c.imageUrl.slice(0, 500) : null,
    condition: c.condition,
    matchScore: c.matchScore ?? null,
    usedInPricing: accepted,
    ignoredAsOutlier: !accepted,
    rawJson: {
      matchClassification: c.matchClassification ?? "rejected",
      matchReasons: c.matchReasons ?? [],
      sourcePayload: c.rawJson ?? null,
    },
    notes: accepted
      ? c.sold
        ? "Accepted automatic sold comp"
        : "Accepted automatic active listing"
      : `Rejected automatic comp: ${(c.matchReasons ?? ["Weak match"]).join("; ")}`.slice(0, 1000),
  };
}
