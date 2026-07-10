"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BarChart3, Loader2, Plug, Search, Shield, Unplug } from "lucide-react";

import { getErrorMessage } from "@/lib/errors";

type StockXStatus = {
  apiEnabled: boolean;
  marketDataEnabled: boolean;
  listingEnabled: boolean;
  connected: boolean;
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
        const response = await fetch("/api/marketplaces/stockx/status", {
          headers: authHeaders(),
        });
        if (!active) return;
        if (!response.ok) throw new Error("status_failed");
        setStatus((await response.json()) as StockXStatus);
        setState("ready");
        setError(null);
      } catch {
        if (active) setState("error");
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
    try {
      const response = await fetch("/api/marketplaces/stockx/connect", {
        headers: { ...authHeaders(), accept: "application/json" },
      });
      const payload = (await response.json()) as { authorizationUrl?: string };
      if (!response.ok || !payload.authorizationUrl) {
        throw new Error("Could not start the StockX connection.");
      }
      window.location.assign(payload.authorizationUrl);
    } catch (e) {
      setError(getErrorMessage(e));
      setBusy(false);
    }
  }, [authHeaders]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/marketplaces/stockx/disconnect", {
        method: "POST",
        headers: authHeaders(),
      });
      setReloadKey((key) => key + 1);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [authHeaders]);

  return (
    <section className="card">
      <div className="card__head">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            className="marketplace-logo"
            style={{ width: 36, height: 36, borderRadius: "var(--r-2)", flexShrink: 0 }}
            aria-hidden="true"
          >
            Sx
          </span>
          <div>
            <div style={{ fontWeight: 500 }}>StockX</div>
            <div className="t-small muted">{describe(state, status)}</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            />
          )}
        </div>
      </div>

      {state === "ready" && status && (
        <div
          style={{
            padding: "12px 20px 14px",
            borderTop: "1px solid var(--line)",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
          }}
          className="t-small"
        >
          <CapabilityLine
            icon={<Search size={13} aria-hidden="true" />}
            label="Catalog matching"
            enabled={status.capabilities.catalogSearch && status.connected}
          />
          <CapabilityLine
            icon={<BarChart3 size={13} aria-hidden="true" />}
            label="Market data"
            enabled={status.capabilities.marketData && status.connected}
          />
          <CapabilityLine
            icon={<Shield size={13} aria-hidden="true" />}
            label="Listing creation"
            enabled={status.capabilities.listingCreation && status.connected}
          />
        </div>
      )}

      {state === "ready" && status && !status.apiEnabled && (
        <p className="t-small muted" style={{ padding: "0 20px 14px", margin: 0 }}>
          StockX catalog matching is staged for connected accounts.
        </p>
      )}

      {error && (
        <p className="t-small danger" style={{ padding: "0 20px 12px", margin: 0 }}>
          {error}
        </p>
      )}
    </section>
  );
}

function StockXAction({
  status,
  busy,
  onConnect,
  onDisconnect,
}: {
  status: StockXStatus;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  if (status.connected) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onDisconnect}
        className="btn btn--ghost btn--sm"
      >
        <Unplug size={13} aria-hidden="true" /> Disconnect
      </button>
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

function CapabilityLine({
  icon,
  label,
  enabled,
}: {
  icon: ReactNode;
  label: string;
  enabled: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ color: enabled ? "var(--positive)" : "var(--ink-4)", flexShrink: 0 }}>
        {icon}
      </span>
      <span style={{ color: enabled ? "var(--ink)" : "var(--ink-4)" }}>{label}</span>
    </div>
  );
}

function describe(state: CardState, status: StockXStatus | null): string {
  if (state === "loading") return "Checking StockX status…";
  if (state === "error" || !status) return "StockX status unavailable.";
  if (!status.apiEnabled) return "Staged · live API off";
  if (status.connected && status.capabilities.listingCreation) return "Connected · listings enabled";
  if (status.connected && status.capabilities.marketData) return "Connected · market data enabled";
  if (status.connected) return "Connected · matching enabled";
  return "Not connected · matching pending";
}
