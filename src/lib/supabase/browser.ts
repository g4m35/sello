"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Session, SupabaseClient } from "@supabase/supabase-js";

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

export async function consumeSupabaseImplicitSessionFromUrl(
  supabase: SupabaseClient,
): Promise<Session | null> {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;

  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (!accessToken || !refreshToken) return null;

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) throw error;

  window.history.replaceState(
    window.history.state,
    document.title,
    `${window.location.pathname}${window.location.search}`,
  );

  return data.session;
}
