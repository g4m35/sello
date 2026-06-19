import Link from "next/link";

import { Badge } from "@/components/ui/primitives";

export type FeatureAllowlists = {
  liveEbayPublish: string[];
  ebayDelist: string[];
  paidComps: string[];
};

export type OperationAttempt = {
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

/**
 * Presentational admin marketplace-operations content. Pure (no data fetching) so
 * it is unit-testable. Counts render ONLY from fetched data once `loaded` is true;
 * while loading it shows a loading state instead of a misleading "0 allowed"
 * placeholder, and a fetch error replaces the body rather than leaving stale zeros.
 */
export function AdminMarketplaceOperationsView({
  loaded,
  error,
  access,
  attempts,
}: {
  loaded: boolean;
  error: string | null;
  access: FeatureAllowlists | null;
  attempts: OperationAttempt[];
}) {
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 className="t-h2">Marketplace operations</h1>
        <Link href="/admin/provider-usage" className="btn btn--secondary btn--sm">
          Paid usage
        </Link>
      </div>

      {!loaded ? (
        <div className="t-small muted">Loading marketplace operations…</div>
      ) : error ? (
        <div className="t-small muted">{error}</div>
      ) : (
        <>
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
          {attempts.length === 0 ? (
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
        </>
      )}
    </>
  );
}
