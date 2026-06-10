"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  CheckCircle2,
  Loader2,
  Plug,
  RefreshCw,
  ShieldCheck,
  Unplug,
  XCircle,
} from "lucide-react";

import { getErrorMessage } from "@/lib/errors";
import { readJsonResponse } from "@/lib/http";
import {
  consumeSupabaseImplicitSessionFromUrl,
  getBrowserSupabase,
} from "@/lib/supabase/browser";
import type { EbayReadinessResponse } from "@/lib/marketplace/adapters/ebay/types";

import { ebayMarketplaceLabels } from "./labels";

type LoadState = "idle" | "loading" | "ready" | "error";

const readinessLabels: Record<string, string> = {
  oauth_connection: "OAuth connection",
  payment_policy: "Payment policy",
  fulfillment_policy: "Fulfillment policy",
  return_policy: "Return policy",
  inventory_location: "Inventory location",
};

const readinessItems = [
  "oauth_connection",
  "payment_policy",
  "fulfillment_policy",
  "return_policy",
  "inventory_location",
] as const;

export default function MarketplaceSettingsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [readiness, setReadiness] = useState<EbayReadinessResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [actionState, setActionState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => getBrowserSupabase(), []);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [session?.access_token]);

  const loadReadiness = useCallback(async () => {
    if (!session?.access_token) return;

    setLoadState("loading");
    setError(null);
    try {
      const payload = await readJsonResponse<EbayReadinessResponse>(
        await fetch("/api/marketplaces/ebay/readiness", {
          headers: authHeaders(),
        }),
      );
      setReadiness(payload);
      setLoadState("ready");
    } catch (err) {
      setError(getErrorMessage(err));
      setLoadState("error");
    }
  }, [authHeaders, session?.access_token]);

  useEffect(() => {
    let mounted = true;

    if (!supabase) {
      const timer = window.setTimeout(() => {
        if (mounted) setError("Supabase browser configuration is missing.");
      }, 0);
      return () => {
        mounted = false;
        window.clearTimeout(timer);
      };
    }

    const browserSupabase = supabase;

    async function loadSession() {
      const consumedSession = await consumeSupabaseImplicitSessionFromUrl(browserSupabase);
      const { data } = consumedSession
        ? { data: { session: consumedSession } }
        : await browserSupabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
    }

    void loadSession();

    const {
      data: { subscription },
    } = browserSupabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReadiness();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadReadiness]);

  async function connectEbay() {
    if (!supabase || !session?.access_token) return;

    setActionState("loading");
    setError(null);
    try {
      const payload = await readJsonResponse<{ authorizationUrl: string }>(
        await fetch("/api/marketplaces/ebay/connect", {
          headers: {
            ...authHeaders(),
            Accept: "application/json",
          },
        }),
      );
      window.location.assign(payload.authorizationUrl);
    } catch (err) {
      setError(getErrorMessage(err));
      setActionState("error");
    }
  }

  async function refreshReadiness() {
    if (!supabase || !session?.access_token) return;

    setActionState("loading");
    setError(null);
    try {
      const payload = await readJsonResponse<EbayReadinessResponse>(
        await fetch("/api/marketplaces/ebay/readiness", {
          method: "POST",
          headers: authHeaders(),
        }),
      );
      setReadiness(payload);
      setActionState("ready");
    } catch (err) {
      setError(getErrorMessage(err));
      setActionState("error");
    }
  }

  async function disconnectEbay() {
    if (!supabase || !session?.access_token) return;

    setActionState("loading");
    setError(null);
    try {
      await readJsonResponse<{ ok: true }>(
        await fetch("/api/marketplaces/ebay/disconnect", {
          method: "POST",
          headers: authHeaders(),
        }),
      );
      await loadReadiness();
      setActionState("ready");
    } catch (err) {
      setError(getErrorMessage(err));
      setActionState("error");
    }
  }

  const missing = new Set(readiness?.missing ?? readinessItems);
  const connected = Boolean(readiness?.connected);
  const ready = Boolean(readiness?.ready);
  const environment = readiness?.environment ?? null;
  const labels = ebayMarketplaceLabels(environment);
  const statusLabel = !connected
    ? "Not connected"
    : !ready
      ? "Connected, setup incomplete"
      : environment === "production"
        ? "Connected, account ready (publishing not enabled yet)"
        : "Connected, ready for sandbox publish";

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-8">
        <header className="flex flex-col gap-2 border-b border-zinc-800 pb-5">
          <p className="text-sm font-medium uppercase tracking-wide text-emerald-300">
            Marketplace Settings
          </p>
          <h1 className="text-3xl font-semibold">{labels.heading}</h1>
        </header>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/70">
          <div className="flex flex-col gap-4 border-b border-zinc-800 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-400/10 text-emerald-300">
                <ShieldCheck size={22} aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">{labels.account}</h2>
                <p className="text-sm text-zinc-400">{statusLabel}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={connectEbay}
                disabled={!session || actionState === "loading"}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-400 px-3 text-sm font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plug size={16} aria-hidden="true" />
                {labels.connect}
              </button>
              <button
                type="button"
                onClick={refreshReadiness}
                disabled={!connected || actionState === "loading"}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-700 px-3 text-sm font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw size={16} aria-hidden="true" />
                Refresh Readiness
              </button>
              <button
                type="button"
                onClick={disconnectEbay}
                disabled={!connected || actionState === "loading"}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-700 px-3 text-sm font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Unplug size={16} aria-hidden="true" />
                Disconnect
              </button>
            </div>
          </div>

          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-5">
            {readinessItems.map((item) => {
              const ok = item === "oauth_connection" ? connected : !missing.has(item);
              const Icon = ok ? CheckCircle2 : XCircle;

              return (
                <div
                  key={item}
                  className="rounded-md border border-zinc-800 bg-zinc-950 p-4"
                >
                  <Icon
                    size={20}
                    className={ok ? "text-emerald-300" : "text-zinc-500"}
                    aria-hidden="true"
                  />
                  <p className="mt-3 text-sm font-medium">{readinessLabels[item]}</p>
                  <p className="mt-1 text-xs text-zinc-500">{ok ? "Ready" : "Missing"}</p>
                </div>
              );
            })}
          </div>

          {(loadState === "loading" || actionState === "loading") && (
            <div className="flex items-center gap-2 border-t border-zinc-800 px-5 py-3 text-sm text-zinc-400">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              Syncing eBay state
            </div>
          )}

          {error && (
            <div className="border-t border-red-900/60 px-5 py-3 text-sm text-red-300">
              Error: {error}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
