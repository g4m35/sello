"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Plug, RefreshCw } from "lucide-react";

import { ConnectionControls } from "./connection-controls";
import { AppError, getErrorMessage } from "@/lib/errors";
import { readJsonResponse } from "@/lib/http";

type StockXNextStep = {
  code: string;
  message: string;
  externalUrl: string | null;
};

type StockXStatus = {
  apiEnabled: boolean;
  marketDataEnabled: boolean;
  listingEnabled: boolean;
  connected: boolean;
  statusLabel: string;
  setupState: string;
  ready: boolean;
  reconnectRequired: boolean;
  sellerProfileIncomplete: boolean;
  nextStep: StockXNextStep | null;
  capabilities: {
    connect: boolean;
    catalogSearch: boolean;
    productMatching: boolean;
    marketData: boolean;
    listingCreation: boolean;
    listingSync: boolean;
    orderSync: boolean;
  };
};

type CardState = "loading" | "ready" | "error";

export function StockXConnectionCard({ accessToken }: { accessToken: string | null }) {
  const [status, setStatus] = useState<StockXStatus | null>(null);
  const [state, setState] = useState<CardState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const authHeaders = useCallback(
    (): Record<string, string> =>
      accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    [accessToken],
  );

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    async function loadStatus() {
      try {
        const payload = await readJsonResponse<StockXStatus>(
          await fetch("/api/marketplaces/stockx/status", {
            headers: authHeaders(),
          }),
        );
        if (!active) return;
        setStatus(payload);
        setState("ready");
        setError(null);
        setErrorCode(null);
      } catch (e) {
        if (active) {
          setState("error");
          setError(getErrorMessage(e));
        }
      }
    }
    void loadStatus();
    return () => {
      active = false;
    };
  }, [accessToken, authHeaders, reloadKey]);

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    setErrorCode(null);
    try {
      const payload = await readJsonResponse<{ authorizationUrl: string }>(
        await fetch("/api/marketplaces/stockx/connect", {
          headers: { ...authHeaders(), accept: "application/json" },
        }),
      );
      window.location.assign(payload.authorizationUrl);
    } catch (e) {
      setError(getErrorMessage(e));
      setErrorCode(e instanceof AppError ? e.code ?? null : null);
      setBusy(false);
    }
  }, [authHeaders]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError(null);
    setErrorCode(null);
    try {
      await readJsonResponse(
        await fetch("/api/marketplaces/stockx/disconnect", {
          method: "POST",
          headers: authHeaders(),
        }),
      );
      setReloadKey((key) => key + 1);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [authHeaders]);

  const recheck = useCallback(() => {
    setState("loading");
    setReloadKey((key) => key + 1);
  }, []);

  const statusLine =
    state === "loading"
      ? "Checking StockX…"
      : state === "error" || !status
        ? "StockX status unavailable"
        : status.statusLabel;

  const showNextStep =
    state === "ready" &&
    status &&
    status.connected &&
    status.nextStep &&
    !status.ready;

  return (
    <section className="connection" aria-labelledby="stockx-heading">
      <div className="connection__head">
        <div className="connection__identity">
          <h2 id="stockx-heading">StockX</h2>
          <span className={`connection__status${status?.connected && !status.reconnectRequired ? " connection__status--connected" : ""}`}>{state === "ready" && status?.connected && !status.reconnectRequired ? "Connected" : statusLine}</span>
        </div>
        <div className="connection__actions">
          {state === "error" && <button type="button" onClick={recheck} className="btn btn--secondary">Try again</button>}
          {state === "loading" && (
            <Loader2
              size={14}
              className="animate-spin"
              style={{ color: "var(--ink-4)" }}
              aria-hidden="true"
            />
          )}
          {state === "ready" && status && (
            <StockXAction
              status={status}
              busy={busy}
              onConnect={connect}
              onDisconnect={disconnect}
              onRecheck={recheck}
            />
          )}
        </div>
      </div>

      {state === "ready" && status?.connected && status.ready && <p className="connection__description">{status.capabilities.listingCreation ? "Listing access enabled." : "Account connected. Listing access is not enabled."}</p>}
      {showNextStep && status?.nextStep && (
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line)" }}>
          <div className="banner banner--warn">
            <div style={{ minWidth: 0 }}>
              <p className="banner__title" style={{ margin: 0 }}>
                Finish StockX setup
              </p>
              <p className="banner__desc" style={{ margin: "4px 0 0" }}>
                {status.nextStep.message}
              </p>
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {status.nextStep.externalUrl && (
                  <a
                    href={status.nextStep.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn--primary btn--sm"
                  >
                    <ExternalLink size={13} aria-hidden="true" />
                    Open StockX
                  </a>
                )}
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={busy}
                  onClick={recheck}
                >
                  <RefreshCw size={13} aria-hidden="true" />
                  I’ve finished — Recheck
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div
          className="connection__error" role="alert"
          style={{ padding: "10px 20px", borderTop: "1px solid var(--line)" }}
        >
          <p style={{ margin: 0 }}>{error}</p>
          {errorCode === "CONNECTION_LIMIT_REACHED" && (
            <p style={{ margin: "6px 0 0" }}>
              <Link href="/settings/billing" style={{ textDecoration: "underline" }}>
                Upgrade plan
              </Link>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function StockXAction({
  status,
  busy,
  onConnect,
  onDisconnect,
  onRecheck,
}: {
  status: StockXStatus;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => Promise<void>;
  onRecheck: () => void;
}) {
  if (status.reconnectRequired) {
    return (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={onConnect}
          className="btn btn--primary btn--sm"
        >
          <Plug size={13} aria-hidden="true" /> Reconnect
        </button>
        <ConnectionControls name="StockX" busy={busy} onDisconnect={onDisconnect} onRecheck={onRecheck} />
      </>
    );
  }

  if (status.connected) {
    return (
      <>
        {!status.ready && (
          <button
            type="button"
            disabled={busy}
            onClick={onRecheck}
            className="btn btn--secondary btn--sm"
          >
            <RefreshCw size={13} aria-hidden="true" /> Recheck
          </button>
        )}
        <ConnectionControls name="StockX" busy={busy} onDisconnect={onDisconnect} onRecheck={onRecheck} />
      </>
    );
  }

  if (status.apiEnabled && status.capabilities.connect) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onConnect}
        className="btn btn--primary btn--sm"
      >
        <Plug size={13} aria-hidden="true" /> Connect StockX
      </button>
    );
  }

  return null;
}
