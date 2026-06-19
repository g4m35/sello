"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AdminNav } from "@/components/app/admin-nav";
import { Topbar } from "@/components/app/topbar";
import { Badge } from "@/components/ui/primitives";
import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";

type FeatureAllowlists = {
  liveEbayPublish: string[];
  ebayDelist: string[];
  paidComps: string[];
};

type OperationAttempt = {
  id: string;
  requestedBy: string;
  itemId: string;
  itemTitle: string;
  action: "publish" | "delist" | "cleanup";
  status: string;
  code: string;
  bulkRunId: string | null;
  externalListingId: string | null;
  createdAt: string;
};

const ALLOWLISTS: { key: keyof FeatureAllowlists; label: string }[] = [
  { key: "liveEbayPublish", label: "Live eBay publishing" },
  { key: "ebayDelist", label: "Live eBay delisting" },
  { key: "paidComps", label: "Paid comps" },
];

const ACTION_LABEL: Record<OperationAttempt["action"], string> = {
  publish: "Publish",
  delist: "Delist",
  cleanup: "Cleanup",
};

export default function AdminMarketplaceOperationsPage() {
  const { token } = useSession();
  const [access, setAccess] = useState<FeatureAllowlists | null>(null);
  const [attempts, setAttempts] = useState<OperationAttempt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getAdminMarketplaceOperations(token)
      .then((res) => {
        if (!active) return;
        setAccess(res.access);
        setAttempts(res.attempts);
      })
      .catch((e) => active && setError((e as { error?: string })?.error ?? "Not found."))
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [token]);

  if (loaded && error) {
    return (
      <>
        <Topbar crumbs={["Admin", "Marketplace ops"]} />
        <div className="page">
          <AdminNav active="/admin/marketplace-operations" />
          <div className="t-small muted">{error}</div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar crumbs={["Admin", "Marketplace ops"]} />
      <div className="page stack-3">
        <AdminNav active="/admin/marketplace-operations" />

        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1 className="t-h2">Marketplace operations</h1>
          <Link href="/admin/provider-usage" className="btn btn--secondary btn--sm">
            Paid usage
          </Link>
        </div>

        <div className="form-grid form-grid--3" style={{ gap: 12 }}>
          {ALLOWLISTS.map(({ key, label }) => {
            const emails = access?.[key] ?? [];
            return (
              <div key={key} className="card" style={{ padding: 12 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="t-micro">{label}</span>
                  <Badge outline label={`${emails.length} allowed`} />
                </div>
                <div className="stack-1" style={{ marginTop: 8 }}>
                  {emails.length === 0 ? (
                    <span className="t-small muted">No accounts allowlisted.</span>
                  ) : (
                    emails.map((email) => (
                      <span key={email} className="t-small">
                        {email}
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <h2 className="t-h3" style={{ marginTop: 8 }}>
          Recent publish / delist / cleanup attempts
        </h2>
        {attempts.length === 0 && loaded ? (
          <div className="t-small muted">No marketplace operations recorded yet.</div>
        ) : (
          <div className="stack-1">
            {attempts.map((a) => (
              <div key={a.id} className="card" style={{ padding: 10 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                  <span className="t-small" style={{ minWidth: 0 }}>
                    <Badge outline label={ACTION_LABEL[a.action]} /> {a.itemTitle}
                  </span>
                  <span className="t-micro">{a.status}</span>
                </div>
                <div className="t-micro muted">
                  seller {a.requestedBy} · item {a.itemId}
                  {a.externalListingId ? ` · listing ${a.externalListingId}` : ""}
                  {a.bulkRunId ? ` · bulk ${a.bulkRunId}` : ""} ·{" "}
                  {new Date(a.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
