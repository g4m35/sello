"use client";

import { useMemo, useState } from "react";

import { api } from "@/lib/api/client";
import type { StockXCatalogCandidate } from "@/lib/marketplace/adapters/stockx/types";
import type { ItemDetailView, StockXMatchView } from "@/lib/view/types";
import { Badge, Banner, Btn } from "@/components/ui/primitives";

type StockXMatchCardProps = {
  accessToken: string;
  draftId: string | null;
  match: StockXMatchView;
  item: {
    title: string;
    brand: string | null;
    category: string;
    size: string | null;
  };
  onSaved: (item: ItemDetailView) => void;
};

export function StockXMatchCard({
  accessToken,
  draftId,
  match,
  item,
  onSaved,
}: StockXMatchCardProps) {
  const defaultQuery = useMemo(
    () => [item.brand, item.title].filter(Boolean).join(" "),
    [item.brand, item.title],
  );
  const [query, setQuery] = useState(defaultQuery);
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<StockXCatalogCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.searchStockXCatalog(accessToken, {
        query,
        brand: item.brand,
        category: item.category,
        size: item.size,
      });
      setCandidates(result.candidates);
      if (result.candidates.length === 0) {
        setError("No StockX products matched that search.");
      }
    } catch (e) {
      setError((e as { error?: string })?.error ?? "StockX search is unavailable.");
      setCandidates([]);
    } finally {
      setBusy(false);
    }
  };

  const saveCandidate = async (candidate: StockXCatalogCandidate) => {
    if (!draftId) return;
    setSavingId(`${candidate.productId}:${candidate.variantId ?? ""}`);
    setError(null);
    try {
      const result = await api.saveStockXMatch(accessToken, {
        ...candidate,
        draftId,
        matchSource: "catalog_search",
        matchConfidence: candidate.variantId ? 0.95 : 0.75,
      });
      if (result.item) onSaved(result.item);
      setCandidates([]);
    } catch (e) {
      setError((e as { error?: string })?.error ?? "Could not save the StockX match.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="card" id="stockx-match">
      <div className="card__head">
        <span className="card__title">StockX match</span>
        <Badge outline label={statusLabel(match.status)} />
      </div>
      <div className="card__body stack-4">
        {match.productId ? (
          <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
            {match.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={match.image}
                alt=""
                style={{
                  width: 48,
                  height: 48,
                  objectFit: "cover",
                  borderRadius: 6,
                  border: "1px solid var(--line)",
                }}
              />
            ) : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mp-row__name">{match.title ?? "StockX product"}</div>
              <div className="mp-row__meta">
                {[match.brand, match.style, match.colorway, match.size]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {match.status === "needs_variant" && (
                <div className="field__error" style={{ marginTop: 6 }}>
                  Choose a size/variant before using StockX market data.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="t-small muted">
            Match this listing to the exact StockX product and size before using StockX comps.
          </div>
        )}

        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            value={query}
            placeholder="Search StockX catalog"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
          />
          <Btn
            variant="secondary"
            size="sm"
            icon="search"
            disabled={!draftId || busy}
            onClick={() => void search()}
          >
            Match StockX product
          </Btn>
        </div>

        {error && (
          <Banner variant="warn" title={error} />
        )}

        {candidates.length > 0 && (
          <div className="stack-4">
            {candidates.map((candidate) => {
              const key = `${candidate.productId}:${candidate.variantId ?? ""}`;
              return (
                <div key={key} className="row" style={{ gap: 10, alignItems: "center" }}>
                  {candidate.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={candidate.image}
                      alt=""
                      style={{
                        width: 40,
                        height: 40,
                        objectFit: "cover",
                        borderRadius: 6,
                        border: "1px solid var(--line)",
                      }}
                    />
                  ) : null}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mp-row__name">{candidate.title}</div>
                    <div className="mp-row__meta">
                      {[candidate.brand, candidate.style, candidate.colorway, candidate.size]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <Btn
                    variant="secondary"
                    size="sm"
                    icon="check"
                    disabled={savingId != null}
                    onClick={() => void saveCandidate(candidate)}
                  >
                    {savingId === key ? "Saving…" : "Use"}
                  </Btn>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function statusLabel(status: StockXMatchView["status"]) {
  if (status === "matched") return "Matched";
  if (status === "needs_variant") return "Needs variant/size";
  if (status === "market_data_unavailable") return "Market data unavailable";
  return "Not matched";
}
