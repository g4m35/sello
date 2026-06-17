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
