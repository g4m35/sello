"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Loader2,
  Plug,
  RefreshCw,
} from "lucide-react";

import { Topbar } from "@/components/app/topbar";
import { ConnectionControls } from "./connection-controls";
import { AppError, getErrorMessage } from "@/lib/errors";
import { readJsonResponse } from "@/lib/http";
import type { EbayReadinessResponse } from "@/lib/marketplace/adapters/ebay/types";
import {
  consumeSupabaseImplicitSessionFromUrl,
  getBrowserSupabase,
} from "@/lib/supabase/browser";

import { ebayMarketplaceLabels } from "./labels";
import { EtsyConnectionCard } from "./etsy-card";
import { StockXConnectionCard } from "./stockx-card";
import {
  ebayReadinessHelp,
  ebayReadinessItems,
  ebayReadinessLabels,
  getEbayConnectionStatus,
  getEbaySalesPermissionLabel,
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
  const [errorCode, setErrorCode] = useState<string | null>(null);
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
    setErrorCode(null);
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
      setErrorCode(err instanceof AppError ? err.code ?? null : null);
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

  const connected = Boolean(readiness?.connected);
  const ready = Boolean(readiness?.ready);
  const missing = new Set(readiness?.missing ?? []);
  const missingItems = ebayReadinessItems.filter((item) => {
    if (item === "oauth_connection") return !connected;
    return missing.has(item);
  }) as EbayReadinessItem[];
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
  const checking = loadState === "idle" || loadState === "loading";
  const statusLabel = loadState === "error" ? "Status unavailable" : getEbayConnectionStatus(readiness);
  const needsSalesPermission = connected && readiness?.salesReadPermission !== true;
  const busy = actionState === "loading";

  return (
    <>
      <Topbar crumbs={["Settings"]} />
      <main className="page marketplace-settings">
        <div className="page__head">
          <div>
            <h1 className="page__title">Marketplaces</h1>
            <p className="page__title-meta">Manage your accounts and the access each marketplace gives Sello.</p>
          </div>
        </div>
        <div className="connections">
          <section className="connection" aria-labelledby="ebay-heading">
            <div className="connection__head">
              <div className="connection__identity">
                <h2 id="ebay-heading">eBay{environment === "sandbox" ? " sandbox" : ""}</h2>
                <span className={`connection__status${connected && !readiness?.reconnectRequired ? " connection__status--connected" : ""}`}>{statusLabel}</span>
              </div>
              <div className="connection__actions">
                {!checking && loadState !== "error" && actionModel.showPrimaryConnect && <button type="button" onClick={connectEbay} disabled={!session || busy} className="btn btn--primary">
                  {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Plug size={16} aria-hidden="true" />}
                  {actionModel.primaryConnectLabel}
                </button>}
                {connected && <ConnectionControls name="eBay" busy={busy} onDisconnect={disconnectEbay} onRecheck={refreshReadiness} />}
                {loadState === "error" && <button type="button" className="btn btn--secondary" onClick={loadReadiness}>Try again</button>}
              </div>
            </div>
            {connected && readiness && <dl className="connection__facts">
              <div><dt>Selling setup</dt><dd>{ready ? "Complete" : "Needs setup"}</dd></div>
              <div><dt>Sales access</dt><dd className={needsSalesPermission ? "connection__warning" : undefined}>{getEbaySalesPermissionLabel(readiness)}</dd></div>
            </dl>}
            {needsSalesPermission && <p className="connection__notice">{readiness?.salesReadPermission == null ? "Your account is connected, but Sello did not save its permissions. Reconnect once to enable sale monitoring." : "Your account is connected, but sales access is missing. Reconnect eBay to enable sale monitoring."}</p>}
            {readiness?.reconnectRequired && <p className="connection__notice">Your eBay connection expired or was revoked. Reconnect to restore access.</p>}
            {connected && !ready && <div className="connection__setup">
              <p>{setupMessage.body}</p>
              <ul className="connection__missing">{missingItems.map(item => <li key={item}><strong>{ebayReadinessLabels[item]}</strong><span>{ebayReadinessHelp[item]}</span></li>)}</ul>
              <div className="connection__actions">
                <a href="https://www.ebay.com/sh/buspolicy" target="_blank" rel="noreferrer" className="btn btn--secondary">Business policies</a>
                <button type="button" onClick={refreshReadiness} disabled={busy} className="btn btn--secondary"><RefreshCw size={16} aria-hidden="true" />Recheck setup</button>
              </div>
            </div>}
            {/* Inventory location form — collapsed by default */}
            {offerLocationSetup && (
              <div style={{ padding: "0 20px", borderBottom: "1px solid var(--line)" }}>
                <details style={{ padding: "14px 0" }}>
                  <summary
                    style={{
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 500,
                      userSelect: "none",
                      listStyle: "none",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    Set up ship-from location
                  </summary>
                  <p className="t-small muted" style={{ margin: "8px 0 14px" }}>
                    eBay has no Seller Hub page for Inventory API locations, so Sello creates one
                    for you. Enter the address your items ship from; it is sent only to eBay.
                  </p>
                  <form
                    className="form-grid"
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
                      <label key={field} className="field">
                        <span className="field__label">{label}</span>
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
                          className="input"
                        />
                      </label>
                    ))}
                    <label className="field">
                      <span className="field__label">Country</span>
                      <input
                        type="text"
                        value="US"
                        disabled
                        className="input"
                        style={{ opacity: 0.5 }}
                      />
                    </label>
                    <div style={{ display: "flex", alignItems: "flex-end" }}>
                      <button
                        type="submit"
                        disabled={!locationFormValid || actionState === "loading"}
                        className="btn btn--primary btn--sm"
                      >
                        Create inventory location
                      </button>
                    </div>
                  </form>
                </details>
              </div>
            )}


            {(checking || busy) && <p className="connection__progress" role="status"><Loader2 size={16} className="animate-spin" aria-hidden="true" />{checking ? "Checking eBay…" : "Updating eBay…"}</p>}
            {error && <div className="connection__error" role="alert"><p>{error}</p>{errorCode === "CONNECTION_LIMIT_REACHED" && <Link href="/settings/billing">View plans</Link>}</div>}
          </section>
          <StockXConnectionCard accessToken={session?.access_token ?? null} />
          <EtsyConnectionCard accessToken={session?.access_token ?? null} />
        </div>
      </main>
    </>
  );
}
