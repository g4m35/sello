"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

// Cookie-backed browser client so the session is readable by server route
// handlers (e.g. the top-level eBay OAuth callback redirect, which carries
// cookies but no Authorization header). autoRefreshToken keeps the cookie
// session fresh while the tab is open.
export function getBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey || url.includes("[") || anonKey.includes("[")) {
    return null;
  }

  browserClient ??= createBrowserClient(url, anonKey);
  return browserClient;
}
