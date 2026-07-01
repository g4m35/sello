// Comp source abstraction, mirroring the marketplace adapter pattern. A source
// fetches real comparable sales/listings for an item. Sources are env-gated:
// if their credentials are not configured, they report `enabled = false` and are
// skipped. Nothing is ever invented — a source with no data returns [].

export type CompQuery = {
  accountId?: string | null;
  draftId?: string | null;
  styleCode: string | null;
  brand: string | null;
  title: string;
  size: string | null;
  category: string;
  stockxProductId?: string | null;
  stockxVariantId?: string | null;
  /** Best free-text search string built from the fields above. */
  keywords: string;
  variants?: CompQueryVariant[];
};

export type CompQueryVariant = {
  kind: "strict" | "broad" | "marketplace";
  keywords: string;
};

export type CompSourceResultKind = "sold_comps" | "active_listings" | "mixed" | "unknown";

export type NormalizedComp = {
  source: string;
  /** Stable id from the source, when available (used for dedupe). */
  externalId: string | null;
  title: string;
  priceCents: number;
  shippingCents: number;
  currency?: string;
  /** ISO date of sale when the source provides sold data; null for active listings. */
  soldDate: string | null;
  url: string | null;
  imageUrl?: string | null;
  /** Whether this is a completed SALE (true) or an active asking price (false). */
  sold: boolean;
  condition: string;
  brand?: string | null;
  size?: string | null;
  category?: string | null;
  rawJson?: unknown;
  matchScore?: number | null;
  matchClassification?: "strong" | "possible" | "weak" | "rejected";
  matchReasons?: string[];
};

export interface CompSource {
  readonly id: string;
  readonly displayName: string;
  /** True when this source returns completed sales, false for active asking prices. */
  readonly sold: boolean;
  /** Declares whether source results are completed sales or market listing estimates. */
  readonly resultKind: CompSourceResultKind;
  /** True for sources that cost money per call (gated by budget/quota controls). */
  readonly paid?: boolean;
  /** Whether the source is configured (has credentials) and may be queried. */
  isEnabled(): boolean;
  fetchComps(query: CompQuery): Promise<NormalizedComp[]>;
}

export interface SoldCompSource extends CompSource {
  readonly sold: true;
  readonly resultKind: "sold_comps";
}
