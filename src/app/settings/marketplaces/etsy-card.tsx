"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plug, Unplug } from "lucide-react";

import { getErrorMessage } from "@/lib/errors";

type EtsyStatus = {
  apiEnabled: boolean;
  connected: boolean;
  capabilities: {
    copy: boolean;
    connect: boolean;
    publish: boolean;
    delist: boolean;
    orders: boolean;
  };
};

type CardState = "loading" | "ready" | "error";

// Self-contained Etsy connection card for the marketplace settings page. It is
// fully gated: the Connect action only appears when the API is enabled and the
// seller is on the connect allowlist. Otherwise it explains that the copy-ready
// Etsy draft remains available, so Etsy is never a dead end.
export function EtsyConnectionCard({ accessToken }: { accessToken: string | null }) {
  const [status, setStatus] = useState<EtsyStatus | null>(null);
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
        const response = await fetch("/api/marketplaces/etsy/status", {
          headers: authHeaders(),
        });
        if (!active) return;
        if (!response.ok) throw new Error("status_failed");
        setStatus((await response.json()) as EtsyStatus);
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
      const response = await fetch("/api/marketplaces/etsy/connect", {
        headers: { ...authHeaders(), accept: "application/json" },
      });
      const payload = (await response.json()) as { authorizationUrl?: string };
      if (!response.ok || !payload.authorizationUrl) {
        throw new Error("Could not start the Etsy connection.");
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
      await fetch("/api/marketplaces/etsy/disconnect", {
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
            style={{ background: "#F1641E" }}
          >
            Et
          </span>
          <div>
            <div className="font-medium text-zinc-100">Etsy</div>
            <div className="text-sm text-zinc-400">{describe(state, status)}</div>
          </div>
        </div>
        {state === "loading" && <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />}
        {state === "ready" && status && (
          <EtsyAction status={status} busy={busy} onConnect={connect} onDisconnect={disconnect} />
        )}
      </div>

      {state === "ready" && status && !canConnect(status) && (
        <p className="mt-3 text-sm text-zinc-400">
          Live Etsy automation is not available for this account yet. You can still
          build an Etsy <span className="text-zinc-200">copy-ready draft</span> from the
          listing editor.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  );
}

function EtsyAction({
  status,
  busy,
  onConnect,
  onDisconnect,
}: {
  status: EtsyStatus;
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
  if (canConnect(status)) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onConnect}
        className="inline-flex items-center gap-2 rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
      >
        <Plug className="h-4 w-4" /> Connect Etsy
      </button>
    );
  }
  return null;
}

function canConnect(status: EtsyStatus): boolean {
  return status.apiEnabled && status.capabilities.connect;
}

function describe(state: CardState, status: EtsyStatus | null): string {
  if (state === "loading") return "Checking Etsy status…";
  if (state === "error" || !status) return "Etsy status unavailable.";
  if (!status.apiEnabled) return "Copy-ready draft · live API not enabled yet";
  if (status.connected) {
    return status.capabilities.publish
      ? "Connected · live publishing enabled"
      : "Connected · live publishing pending access";
  }
  if (!status.capabilities.connect) return "Copy-ready draft · live access limited to alpha";
  return "Not connected · copy-ready draft available";
}
