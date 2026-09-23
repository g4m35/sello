"use client";

import Link from "next/link";

import { useSession } from "@/components/providers/session-provider";
import { Btn } from "@/components/ui/primitives";
import { Topbar } from "@/components/app/topbar";

export default function SettingsPage() {
  const { session, name, signOut, requestNameEdit } = useSession();
  const email = session.user.email ?? "";

  return (
    <>
      <Topbar crumbs={["Settings"]} />

      <main className="page">
        <div className="page__head">
          <div>
            <h1 className="page__title">
              Settings<em>.</em>
            </h1>
            <div className="page__title-meta">Account, billing, and legal</div>
          </div>
        </div>

        <div className="stack-4" style={{ display: "grid", gap: 16 }}>
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
              <span className="card__title">Billing</span>
            </div>
            <div className="card__body">
              <div
                className="row"
                style={{ gap: 12, alignItems: "center", justifyContent: "space-between" }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>Plan and usage</div>
                  <div className="t-small muted" style={{ marginTop: 4 }}>
                    Manage subscription, usage limits, and available plans.
                  </div>
                </div>
                <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <Link href="/pricing" className="btn btn--ghost btn--sm">
                    View pricing
                  </Link>
                  <Link href="/settings/billing" className="btn btn--secondary btn--sm">
                    Manage billing
                  </Link>
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
