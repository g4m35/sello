"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plug, Unplug } from "lucide-react";

import { AppError, getErrorMessage } from "@/lib/errors";
import { readJsonResponse } from "@/lib/http";

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

export function EtsyConnectionCard({ accessToken }: { accessToken: string | null }) {
  const [status, setStatus] = useState<EtsyStatus | null>(null);
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
        const payload = await readJsonResponse<EtsyStatus>(
          await fetch("/api/marketplaces/etsy/status", {
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
        await fetch("/api/marketplaces/etsy/connect", {
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
        await fetch("/api/marketplaces/etsy/disconnect", {
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

  const statusLine =
    state === "loading"
      ? "Checking Etsy…"
      : state === "error" || !status
        ? "Etsy status unavailable"
        : !status.apiEnabled
          ? "Drafts"
          : status.connected
            ? status.capabilities.publish
              ? "Connected · ready"
              : "Connected · drafts"
            : !status.capabilities.connect
              ? "Drafts"
              : "Not connected";

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
            <div className="t-small muted">{statusLine}</div>
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

      {state === "ready" && status && !canConnect(status) && !status.connected && (
        <p className="t-small muted" style={{ padding: "10px 20px", margin: 0 }}>
          Etsy drafts are available from the listing editor.
        </p>
      )}

      {error && (
        <div
          className="t-small danger"
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
