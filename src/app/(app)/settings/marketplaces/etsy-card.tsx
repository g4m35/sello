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
    <section className="card">
      <div className="card__head">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            className="marketplace-logo"
            style={{ width: 36, height: 36, borderRadius: "var(--r-2)", flexShrink: 0 }}
            aria-hidden="true"
          >
            Et
          </span>
          <div>
            <div style={{ fontWeight: 500 }}>Etsy</div>
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
            <EtsyAction
              status={status}
              busy={busy}
              onConnect={connect}
              onDisconnect={disconnect}
            />
          )}
        </div>
      </div>

      {state === "ready" && status && !canConnect(status) && (
        <p className="t-small muted" style={{ padding: "10px 20px", margin: 0 }}>
          Etsy drafts are available from the listing editor.
        </p>
      )}

      {error && (
        <p className="t-small danger" style={{ padding: "10px 20px", margin: 0 }}>
          {error}
        </p>
      )}
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
        className="btn btn--ghost btn--sm"
      >
        <Unplug size={13} aria-hidden="true" /> Disconnect
      </button>
    );
  }
  if (canConnect(status)) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onConnect}
        className="btn btn--primary btn--sm"
      >
        <Plug size={13} aria-hidden="true" /> Connect Etsy
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
  if (!status.apiEnabled) return "Drafts";
  if (status.connected) {
    return status.capabilities.publish
      ? "Connected · live"
      : "Connected · drafts";
  }
  if (!status.capabilities.connect) return "Drafts";
  return "Not connected";
}
