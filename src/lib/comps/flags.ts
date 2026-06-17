// Centralized, env-gated provider flags for the automatic price-comp pipeline.
//
// Canonical names use the COMPS_* prefix (the documented contract). Legacy
// PRICE_COMP_* names are still honored so existing environments keep working.
// Every provider is OFF by default and requires both an explicit enable flag
// AND its credentials, so nothing ever calls an external API unless deliberately
// configured. COMPS_AUTO_DISCOVERY_ENABLED is the global kill switch.

type Env = Record<string, string | undefined>;

function on(env: Env, ...names: string[]): boolean {
  return names.some((name) => env[name] === "true");
}

function has(env: Env, ...names: string[]): boolean {
  return names.some((name) => Boolean(env[name] && env[name]!.trim().length > 0));
}

function intInRange(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function numberInRange(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function isCompsAutoDiscoveryEnabled(env: Env = process.env): boolean {
  return on(env, "COMPS_AUTO_DISCOVERY_ENABLED", "PRICE_COMP_AUTO_DISCOVERY_ENABLED");
}

export function isApifyEbaySoldEnabled(env: Env = process.env): boolean {
  return (
    on(env, "COMPS_APIFY_EBAY_SOLD_ENABLED", "PRICE_COMP_APIFY_EBAY_SOLD_ENABLED") &&
    has(env, "APIFY_TOKEN")
  );
}

export function hasEbayBrowseCredentials(env: Env = process.env): boolean {
  return (
    has(env, "EBAY_BROWSE_CLIENT_ID", "EBAY_CLIENT_ID") &&
    has(env, "EBAY_BROWSE_CLIENT_SECRET", "EBAY_CLIENT_SECRET")
  );
}

export function isEbayActiveEnabled(env: Env = process.env): boolean {
  return (
    on(env, "COMPS_EBAY_ACTIVE_ENABLED", "PRICE_COMP_EBAY_SEARCH_ENABLED") &&
    hasEbayBrowseCredentials(env)
  );
}

export function isSerpapiEbayActiveEnabled(env: Env = process.env): boolean {
  return on(env, "COMPS_SERPAPI_EBAY_ACTIVE_ENABLED") && has(env, "SERPAPI_API_KEY");
}

export function compsMaxProviderResults(env: Env = process.env): number {
  return intInRange(env.COMPS_MAX_PROVIDER_RESULTS, 20, 1, 30);
}

export function compsMaxQueryVariants(env: Env = process.env): number {
  return intInRange(env.COMPS_MAX_QUERY_VARIANTS, 2, 1, 3);
}

export function compsAutoMinIdentityConfidence(env: Env = process.env): number {
  return numberInRange(env.COMPS_AUTO_MIN_IDENTITY_CONFIDENCE, 0.55, 0, 1);
}
