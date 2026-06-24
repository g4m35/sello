"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { EtsyConnectionCard } from "./etsy-card";
import {
  ebayReadinessHelp,
  ebayReadinessItems,
  ebayReadinessLabels,
  getEbayActionModel,
  getEbaySetupMessage,
  shouldAutoRefreshEbayReadiness,
  shouldOfferEbayLocationSetup,
  type EbayReadinessItem,
} from "./view-model";

type LoadState = "idle" | "loading" | "ready" | "error";

type LocationForm = {
  name: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  phone: string;
};

const emptyLocationForm: LocationForm = {
  name: "Default location",
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateOrProvince: "",
  postalCode: "",
  phone: "",
};

export default function MarketplaceSettingsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [readiness, setReadiness] = useState<EbayReadinessResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [actionState, setActionState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [locationForm, setLocationForm] = useState<LocationForm>(emptyLocationForm);
  const autoRefreshAttemptedRef = useRef(false);
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

  const connectEbay = useCallback(async () => {
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
  }, [authHeaders, session?.access_token, supabase]);

  const refreshReadiness = useCallback(async () => {
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
  }, [authHeaders, session?.access_token, supabase]);

  const createInventoryLocation = useCallback(async () => {
    if (!supabase || !session?.access_token) return;

    setActionState("loading");
    setError(null);
    try {
      await readJsonResponse<{ ok: true }>(
        await fetch("/api/marketplaces/ebay/locations", {
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: locationForm.name,
            addressLine1: locationForm.addressLine1,
            ...(locationForm.addressLine2.trim()
              ? { addressLine2: locationForm.addressLine2 }
              : {}),
            city: locationForm.city,
            stateOrProvince: locationForm.stateOrProvince,
            postalCode: locationForm.postalCode,
            country: "US",
            ...(locationForm.phone.trim() ? { phone: locationForm.phone } : {}),
          }),
        }),
      );
      // Creation succeeded: re-check readiness so the tile flips to Ready.
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
  }, [authHeaders, locationForm, session?.access_token, supabase]);

  const disconnectEbay = useCallback(async () => {
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
  }, [authHeaders, loadReadiness, session?.access_token, supabase]);

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

  useEffect(() => {
    if (
      !shouldAutoRefreshEbayReadiness(
        readiness,
        autoRefreshAttemptedRef.current,
      )
    ) {
      return;
    }

    autoRefreshAttemptedRef.current = true;
    void refreshReadiness();
  }, [readiness, refreshReadiness]);

  const missing = new Set(readiness?.missing ?? ebayReadinessItems);
  const connected = Boolean(readiness?.connected);
  const ready = Boolean(readiness?.ready);
  const environment = readiness?.environment ?? null;
  const labels = ebayMarketplaceLabels(environment);
  const setupMessage = getEbaySetupMessage(readiness);
  const actionModel = getEbayActionModel(readiness, labels.connect);
  const offerLocationSetup = shouldOfferEbayLocationSetup(readiness);
  const locationFormValid =
    locationForm.name.trim().length > 0 &&
    locationForm.addressLine1.trim().length > 0 &&
    locationForm.city.trim().length > 0 &&
    locationForm.stateOrProvince.trim().length >= 2 &&
    /^\d{5}(-\d{4})?$/.test(locationForm.postalCode.trim());
  const statusLabel = readiness?.reconnectRequired
    ? "Connection expired, reconnect your eBay account"
    : !connected
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

        <EtsyConnectionCard accessToken={session?.access_token ?? null} />

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
              {actionModel.showPrimaryConnect && (
                <button
                  type="button"
                  onClick={connectEbay}
                  disabled={!session || actionState === "loading"}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-400 px-3 text-sm font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plug size={16} aria-hidden="true" />
                  {actionModel.primaryConnectLabel}
                </button>
              )}
              {actionModel.showSecondaryReconnect && (
                <button
                  type="button"
                  onClick={connectEbay}
                  disabled={!session || actionState === "loading"}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-700 px-3 text-sm font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plug size={16} aria-hidden="true" />
                  {actionModel.secondaryReconnectLabel}
                </button>
              )}
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

          {connected && !ready && (
            <div className="border-b border-zinc-800 p-5">
              <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-4">
                <h3 className="text-sm font-semibold text-amber-100">
                  {setupMessage.heading}
                </h3>
                <p className="mt-1 text-sm text-amber-50/80">{setupMessage.body}</p>
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  <a
                    href="https://www.ebay.com/sh/buspolicy"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-amber-100 underline underline-offset-4"
                  >
                    Open eBay business policies
                  </a>
                  <a
                    href="https://www.ebay.com/sh/ovw"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-amber-100 underline underline-offset-4"
                  >
                    Open Seller Hub
                  </a>
                </div>
              </div>
            </div>
          )}

          {offerLocationSetup && (
            <div className="border-b border-zinc-800 p-5">
              <div className="rounded-md border border-zinc-700 bg-zinc-950 p-4">
                <h3 className="text-sm font-semibold">
                  Create your ship-from inventory location
                </h3>
                <p className="mt-1 text-sm text-zinc-400">
                  eBay has no Seller Hub page for Inventory API locations, so
                  Sello creates one for you. Enter the address your items ship
                  from; it is sent only to eBay.
                </p>
                <form
                  className="mt-4 grid gap-3 sm:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void createInventoryLocation();
                  }}
                >
                  {(
                    [
                      ["name", "Location name", "Default location", true],
                      ["addressLine1", "Address line 1", "123 Main St", true],
                      ["addressLine2", "Address line 2 (optional)", "Apt 4", false],
                      ["city", "City", "San Francisco", true],
                      ["stateOrProvince", "State", "CA", true],
                      ["postalCode", "ZIP code", "94103", true],
                      ["phone", "Phone (optional)", "415-555-0100", false],
                    ] as const
                  ).map(([field, label, placeholder, required]) => (
                    <label key={field} className="flex flex-col gap-1 text-sm">
                      <span className="text-zinc-400">{label}</span>
                      <input
                        type="text"
                        required={required}
                        value={locationForm[field]}
                        placeholder={placeholder}
                        onChange={(e) =>
                          setLocationForm((prev) => ({
                            ...prev,
                            [field]: e.target.value,
                          }))
                        }
                        className="h-10 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-zinc-100 placeholder:text-zinc-600"
                      />
                    </label>
                  ))}
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-zinc-400">Country</span>
                    <input
                      type="text"
                      value="US"
                      disabled
                      className="h-10 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-zinc-500"
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      disabled={!locationFormValid || actionState === "loading"}
                      className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-400 px-3 text-sm font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Create inventory location
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-5">
            {ebayReadinessItems.map((item) => {
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
                  <p className="mt-3 text-sm font-medium">
                    {ebayReadinessLabels[item]}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {ok ? "Ready" : "Missing"}
                  </p>
                  {!ok && (
                    <p className="mt-3 text-xs leading-5 text-zinc-400">
                      {ebayReadinessHelp[item as EbayReadinessItem]}
                    </p>
                  )}
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
