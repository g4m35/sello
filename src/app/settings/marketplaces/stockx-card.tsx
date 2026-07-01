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
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="grid h-9 w-9 place-items-center rounded font-mono text-sm font-semibold text-white"
            style={{ background: "#0B7C2B" }}
          >
            SX
          </span>
          <div>
            <div className="font-medium text-zinc-100">StockX</div>
            <div className="text-sm text-zinc-400">{describe(state, status)}</div>
          </div>
        </div>
        {state === "loading" && <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />}
        {state === "ready" && status && (
          <StockXAction
            status={status}
            busy={busy}
            onConnect={connect}
            onDisconnect={disconnect}
          />
        )}
      </div>

      {state === "ready" && status && (
        <div className="mt-4 grid gap-2 text-sm text-zinc-400 sm:grid-cols-3">
          <CapabilityLine
            icon={<Search className="h-4 w-4" />}
            label="Catalog matching"
            enabled={status.capabilities.catalogSearch && status.connected}
          />
          <CapabilityLine
            icon={<BarChart3 className="h-4 w-4" />}
            label="Market data"
            enabled={status.capabilities.marketData && status.connected}
          />
          <CapabilityLine
            icon={<Shield className="h-4 w-4" />}
            label="Listing creation"
            enabled={false}
          />
        </div>
      )}

      {state === "ready" && status && !status.apiEnabled && (
        <p className="mt-3 text-sm text-zinc-400">
          StockX is staged for catalog matching. Live API calls are off until the
          production flags and credentials are complete.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
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
        className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
      >
        <Unplug className="h-4 w-4" /> Disconnect
      </button>
    );
  }
  if (status.apiEnabled && status.capabilities.connect) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onConnect}
        className="inline-flex items-center gap-2 rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
      >
        <Plug className="h-4 w-4" /> Connect StockX
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
    <div className="flex items-center gap-2">
      <span className={enabled ? "text-emerald-300" : "text-zinc-600"}>{icon}</span>
      <span className={enabled ? "text-zinc-200" : "text-zinc-500"}>{label}</span>
    </div>
  );
}

function describe(state: CardState, status: StockXStatus | null): string {
  if (state === "loading") return "Checking StockX status…";
  if (state === "error" || !status) return "StockX status unavailable.";
  if (!status.apiEnabled) return "Staged · live API off";
  if (status.connected && status.capabilities.marketData) return "Connected · market data enabled";
  if (status.connected) return "Connected · matching enabled";
  return "Not connected · matching pending";
}
