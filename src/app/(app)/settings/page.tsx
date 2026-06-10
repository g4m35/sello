"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { useSession } from "@/components/providers/session-provider";
import { readJsonResponse } from "@/lib/http";
import { Badge, Btn } from "@/components/ui/primitives";
import { Topbar } from "@/components/app/topbar";
import type { EbayReadinessResponse } from "@/lib/marketplace/adapters/ebay/types";

export default function SettingsPage() {
  const { session, token, name, signOut, requestNameEdit } = useSession();
  const [ebay, setEbay] = useState<EbayReadinessResponse | null>(null);
  const [ebayError, setEbayError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const payload = await readJsonResponse<EbayReadinessResponse>(
          await fetch("/api/marketplaces/ebay/readiness", {
            headers: { Authorization: `Bearer ${token}` },
          }),
        );
        if (active) {
          setEbay(payload);
          setEbayError(null);
        }
      } catch (e) {
        if (active) {
          setEbayError((e as { error?: string })?.error ?? "Failed to load eBay status.");
        }
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [token]);

  const email = session.user.email ?? "";
  const ebayStatus = ebayError
    ? { status: "failed" as const, label: "Status unavailable" }
    : !ebay
      ? { status: "draft" as const, label: "Checking…" }
      : !ebay.connected
        ? { status: "noimpl" as const, label: "Not connected" }
        : ebay.ready
          ? { status: "ready" as const, label: "Connected" }
          : { status: "draft" as const, label: "Connected, setup incomplete" };

  return (
    <>
      <Topbar crumbs={["Settings"]} />

      <main className="page">
        <div className="page__head">
          <div>
            <h1 className="page__title">
              Settings<em>.</em>
            </h1>
            <div className="page__title-meta">Account, connections, and legal</div>
          </div>
        </div>

        <div className="stack-4" style={{ display: "grid", gap: 16 }}>
          <section className="card">
            <div className="card__head">
              <span className="card__title">Marketplace connections</span>
            </div>
            <div className="card__body">
              <div
                className="row"
                style={{ gap: 12, alignItems: "center", justifyContent: "space-between" }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>eBay</div>
                  <div className="t-small muted" style={{ marginTop: 4 }}>
                    {ebayError ?? "OAuth connection, policies, and publish readiness."}
                  </div>
                </div>
                <div className="row" style={{ gap: 10, alignItems: "center" }}>
                  <Badge status={ebayStatus.status} label={ebayStatus.label} />
                  <Link href="/settings/marketplaces" className="btn btn--secondary btn--sm">
                    Manage
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card__head">
              <span className="card__title">Account</span>
            </div>
            <div className="card__body">
              <div className="stack-4" style={{ display: "grid", gap: 12 }}>
                <div
                  className="row"
                  style={{ gap: 12, alignItems: "center", justifyContent: "space-between" }}
                >
                  <div>
                    <div className="t-small muted">Display name</div>
                    <div style={{ fontWeight: 500 }}>{name}</div>
                  </div>
                  <Btn variant="secondary" size="sm" icon="edit" onClick={requestNameEdit}>
                    Edit
                  </Btn>
                </div>
                <div
                  className="row"
                  style={{ gap: 12, alignItems: "center", justifyContent: "space-between" }}
                >
                  <div>
                    <div className="t-small muted">Email</div>
                    <div style={{ fontWeight: 500 }}>{email}</div>
                  </div>
                </div>
                <div
                  className="row"
                  style={{ gap: 12, alignItems: "center", justifyContent: "space-between" }}
                >
                  <div>
                    <div className="t-small muted">Session</div>
                    <div className="t-small">Signed in via magic link</div>
                  </div>
                  <Btn variant="ghost" size="sm" icon="logout" onClick={() => void signOut()}>
                    Sign out
                  </Btn>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card__head">
              <span className="card__title">Legal</span>
            </div>
            <div className="card__body">
              <div
                className="row"
                style={{ gap: 12, alignItems: "center", justifyContent: "space-between" }}
              >
                <div className="t-small muted">How we handle your data.</div>
                <Link href="/privacy" className="btn btn--ghost btn--sm">
                  Privacy policy
                </Link>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
