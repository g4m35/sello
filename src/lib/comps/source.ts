// Comp source abstraction, mirroring the marketplace adapter pattern. A source
// fetches real comparable sales/listings for an item. Sources are env-gated:
// if their credentials are not configured, they report `enabled = false` and are
// skipped. Nothing is ever invented — a source with no data returns [].

export type CompQuery = {
  styleCode: string | null;
  brand: string | null;
  title: string;
  size: string | null;
  category: string;
  /** Best free-text search string built from the fields above. */
  keywords: string;
};

export type NormalizedComp = {
  source: string;
  /** Stable id from the source, when available (used for dedupe). */
  externalId: string | null;
  title: string;
  priceCents: number;
  shippingCents: number;
  /** ISO date of sale when the source provides sold data; null for active listings. */
  soldDate: string | null;
  url: string | null;
  /** Whether this is a completed SALE (true) or an active asking price (false). */
  sold: boolean;
  condition: string;
};

export interface CompSource {
  readonly id: string;
  readonly displayName: string;
  /** True when this source returns completed sales, false for active asking prices. */
  readonly sold: boolean;
  /** Whether the source is configured (has credentials) and may be queried. */
  isEnabled(): boolean;
  fetchComps(query: CompQuery): Promise<NormalizedComp[]>;
}
