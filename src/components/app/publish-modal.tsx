"use client";

import { useEffect, useState } from "react";

import { Icon } from "@/components/ui/icon";
import { Badge, Banner, Btn, Check, Modal } from "@/components/ui/primitives";
import { MpLogo } from "@/components/ui/marketplace";
import { ebayPreflightMissingLabels } from "@/components/app/ebay-preflight-card";
import { api } from "@/lib/api/client";
import { useFeatureAccess } from "@/components/providers/feature-access-provider";
import { useSession } from "@/components/providers/session-provider";
import { formatMoneyCents } from "@/lib/view/format";
import type { EbayPreflightResult } from "@/lib/marketplace/adapters/ebay/preflight";
import {
  buildEbayPublishReview,
  canSubmitLiveEbayPublish,
} from "@/lib/marketplace/adapters/ebay/publish-review";
import type { ItemView } from "@/lib/view/types";

type Stage = "review" | "running" | "result";

type Outcome = {
  marketplace: string;
  name: string;
  status: "pending" | "running" | "submitted" | "published" | "not_implemented" | "failed";
  reason?: string;
};

export function PublishModal({
  open,
  onClose,
  item,
  onPublished,
}: {
  open: boolean;
  onClose: () => void;
  item: ItemView | null;
  onPublished?: () => void;
}) {
  const { token } = useSession();
  const { access, copy } = useFeatureAccess();
  const liveEbayEntitled = access.liveEbayPublish;
  const [stage, setStage] = useState<Stage>("review");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  // Live eBay final review (loaded from the dry-run preflight) and the explicit
  // confirmation the seller must give before a live listing is created.
  const [preflight, setPreflight] = useState<EbayPreflightResult | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);
  const [confirmStockX, setConfirmStockX] = useState(false);

  // Reset the modal each time it opens for an item (render-phase derived state).
  const openKey = open && item ? item.id : null;
  const [initKey, setInitKey] = useState<string | null>(null);
  if (openKey !== initKey) {
    setInitKey(openKey);
    if (openKey && item) {
      setSelected(
        new Set(
          item.channels
            .filter((c) => c.publishImplemented)
            .map((c) => c.marketplace),
        ),
      );
      setStage("review");
      setOutcomes([]);
      setPreflight(null);
      setPreflightError(null);
      setConfirmLive(false);
      setConfirmStockX(false);
    }
  }

  const itemId = item?.id ?? null;
  // A live eBay publish is only possible when eBay's publish capability is on
  // (production flag enabled) AND the seller has eBay selected. In every other
  // case this is false and the live-review path is skipped entirely.
  const selectedLiveEbay = Boolean(
    item?.channels.some(
      (c) =>
        c.marketplace === "ebay" &&
        c.publishImplemented &&
        selected.has(c.marketplace),
    ),
  );
  const selectedLiveStockX = Boolean(
    item?.channels.some(
      (c) =>
        c.marketplace === "stockx" &&
        selected.has(c.marketplace),
    ),
  );

  // Fetch the dry-run preflight to drive the final review. Zero outbound eBay
  // calls (the preflight route is read-only); follows the project's effect rule
  // of setting state only inside the async runner after the await.
  useEffect(() => {
    if (!open || !selectedLiveEbay || !itemId) return;
    let active = true;
    async function run() {
      try {
        const result = await api.ebayPreflight(token, itemId!);
        if (active) setPreflight(result);
      } catch (e) {
        if (active) {
          setPreflightError(
            (e as { error?: string })?.error ??
              "Could not load the eBay review.",
          );
        }
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [open, selectedLiveEbay, itemId, token]);

  if (!item) return null;

  const toggle = (mp: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mp)) next.delete(mp);
      else next.add(mp);
      return next;
    });
  };

  async function run() {
    if (!item) return;
    const chosen = item.channels.filter((c) => selected.has(c.marketplace));
    setStage("running");
    setOutcomes(chosen.map((c) => ({ marketplace: c.marketplace, name: c.name, status: "pending" })));

    const results: Outcome[] = [];
    for (const c of chosen) {
      setOutcomes((prev) =>
        prev.map((o) => (o.marketplace === c.marketplace ? { ...o, status: "running" } : o)),
      );
      try {
        const res = await api.publish(token, {
          inventoryItemId: item.id,
          marketplace: c.marketplace,
          ...(c.marketplace === "stockx" ? { confirmLivePublish: true as const } : {}),
        });
        const outcome: Outcome = {
          marketplace: c.marketplace,
          name: c.name,
          status:
            res.status === "published"
              ? "published"
              : res.status === "submitted"
                ? "submitted"
                : "not_implemented",
          reason: res.reason ?? res.message,
        };
        results.push(outcome);
        setOutcomes((prev) => prev.map((o) => (o.marketplace === c.marketplace ? outcome : o)));
      } catch (e) {
        const outcome: Outcome = {
          marketplace: c.marketplace,
          name: c.name,
          status: "failed",
          reason: (e as { error?: string })?.error ?? "Request failed",
        };
        results.push(outcome);
        setOutcomes((prev) => prev.map((o) => (o.marketplace === c.marketplace ? outcome : o)));
      }
    }
    setStage("result");
    onPublished?.();
  }

  const selectedCount = selected.size;
  // Loading is derived (not stored) so the effect never sets state synchronously.
  const preflightLoading =
    selectedLiveEbay && preflight === null && preflightError === null;
  const review = preflight ? buildEbayPublishReview(preflight) : null;
  const reviewReady = review?.ready === true;
  const liveSubmitReady = canSubmitLiveEbayPublish({
    reviewReady,
    confirmed: confirmLive,
  });
  const stockxSubmitReady = !selectedLiveStockX || confirmStockX;
  const liveSubmitReadyForSelection =
    (selectedLiveEbay ? liveSubmitReady : true) && stockxSubmitReady;
  const livePublishCount = Number(selectedLiveEbay) + Number(selectedLiveStockX);
  const livePublishTitle =
    livePublishCount > 1
      ? "Final live publish review"
      : selectedLiveEbay
        ? "Final eBay publish review"
        : selectedLiveStockX
          ? "Final StockX listing review"
          : "Publishing isn't enabled yet";
  const livePublishDescription =
    livePublishCount > 1
      ? "Confirming creates live listing operations for each selected marketplace. Sello checks each channel's readiness before sending anything out."
      : selectedLiveEbay
        ? "Confirming creates a live eBay listing. Sello will run the readiness preflight again before sending anything to eBay."
        : selectedLiveStockX
          ? "Confirming creates a live StockX listing operation for the matched product and size."
          : "Listings stay draft-only. Running publish records a real, audited attempt per channel and returns each marketplace's not-implemented status; nothing is sent to any marketplace.";
  const livePublishAction =
    livePublishCount > 1
      ? "Create live listings"
      : selectedLiveEbay
        ? "Create live eBay listing"
        : selectedLiveStockX
          ? "Create live StockX listing"
          : `Record publish attempt (${selectedCount})`;

  return (
    <Modal open={open} onClose={stage === "running" ? undefined : onClose} wide>
      {stage === "review" && (
        <>
          <div className="modal__head">
            <div>
              <div className="modal__title">
                Publish <em>{item.title}</em>
              </div>
              <div className="modal__sub">
                {formatMoneyCents(item.priceCents)} · {item.channels.length} configured channels
              </div>
            </div>
            <button className="modal__close" onClick={onClose}>
              <Icon name="x" size={16} />
            </button>
          </div>
          <div className="modal__body stack-4">
            {selectedLiveEbay && !liveEbayEntitled ? (
              <Banner variant="info" title="Preview only" desc={copy.liveEbayPublish} />
            ) : (
              <Banner
                variant="warn"
                title={livePublishTitle}
                desc={livePublishDescription}
              />
            )}
            {selectedLiveEbay && (
              <div className="card" style={{ padding: 12 }}>
                <div className="t-small" style={{ fontWeight: 600, marginBottom: 8 }}>
                  Review the live eBay listing
                </div>
                {preflightLoading && (
                  <div className="t-small muted">Loading the final eBay review…</div>
                )}
                {preflightError && (
                  <div className="t-small" style={{ color: "var(--red, #f87171)" }}>
                    Could not load the eBay review: {preflightError}
                  </div>
                )}
                {review && !review.ready && (
                  <div className="stack-2">
                    <div className="t-small" style={{ fontWeight: 500 }}>
                      Resolve these before publishing to eBay:
                    </div>
                    <ul className="t-small muted" style={{ paddingLeft: 18, margin: 0 }}>
                      {review.missing.map((id) => (
                        <li key={id}>{ebayPreflightMissingLabels[id] ?? id}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {review?.ready && (
                  <div className="stack-2">
                    <ReviewRow label="Marketplace" value={review.review.marketplaceLabel} />
                    <ReviewRow label="Title" value={review.review.title} />
                    <ReviewRow label="Price" value={review.review.priceLabel} />
                    <ReviewRow label="Category" value={review.review.categoryLabel} />
                    <ReviewRow label="Quantity" value={String(review.review.quantity)} />
                    <ReviewRow label="Condition" value={review.review.conditionLabel} />
                    <ReviewRow label="Payment policy" value={review.review.policies.payment} />
                    <ReviewRow
                      label="Fulfillment policy"
                      value={review.review.policies.fulfillment}
                    />
                    <ReviewRow label="Return policy" value={review.review.policies.return} />
                    <ReviewRow label="Inventory location" value={review.review.location} />
                    {liveEbayEntitled && (
                      <label
                        className="row"
                        style={{ gap: 8, alignItems: "center", cursor: "pointer", marginTop: 4 }}
                      >
                        <Check
                          checked={confirmLive}
                          onChange={() => setConfirmLive((v) => !v)}
                        />
                        <span className="t-small">
                          I understand this creates a live eBay listing on eBay (
                          {review.review.environment}).
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}
            {selectedLiveStockX && (
              <div className="card" style={{ padding: 12 }}>
                <div className="t-small" style={{ fontWeight: 600, marginBottom: 8 }}>
                  Review the live StockX listing
                </div>
                <div className="stack-2">
                  <ReviewRow label="Marketplace" value="StockX" />
                  <ReviewRow label="Title" value={item.title} />
                  <ReviewRow label="Price" value={formatMoneyCents(item.priceCents)} />
                  <ReviewRow label="Quantity" value="1" />
                  <label
                    className="row"
                    style={{ gap: 8, alignItems: "center", cursor: "pointer", marginTop: 4 }}
                  >
                    <Check
                      checked={confirmStockX}
                      onChange={() => setConfirmStockX((v) => !v)}
                    />
                    <span className="t-small">
                      I understand this creates a live StockX listing operation for the saved product match.
                    </span>
                  </label>
                </div>
              </div>
            )}
            <div className="mp-select">
              {item.channels.map((c) => {
                const on = selected.has(c.marketplace);
                return (
                  <div
                    key={c.marketplace}
                    className={`mp-select__row ${on ? "mp-select__row--selected" : ""}`}
                    onClick={() => toggle(c.marketplace)}
                  >
                    <Check checked={on} onChange={() => toggle(c.marketplace)} />
                    <MpLogo id={c.marketplace} size={36} />
                    <div style={{ minWidth: 0 }}>
                      <div className="mp-row__name">{c.name}</div>
                      <div className="mp-row__meta">
                        {c.publishImplemented ? "Live publish enabled" : "Draft preview only / not implemented"}
                      </div>
                    </div>
                    <Badge status={c.status} />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="modal__foot">
            <div className="t-small">{selectedCount} channels selected</div>
            <div className="row">
              <Btn variant="ghost" onClick={onClose}>
                Cancel
              </Btn>
              {selectedLiveEbay && !liveEbayEntitled ? null : (
                <Btn
                  variant="accent"
                  disabled={
                    selectedLiveEbay || selectedLiveStockX
                      ? !liveSubmitReadyForSelection
                      : selectedCount === 0
                  }
                  onClick={run}
                >
                  {livePublishAction}
                </Btn>
              )}
            </div>
          </div>
        </>
      )}

      {(stage === "running" || stage === "result") && (
        <>
          <div className="modal__head">
            <div>
              <div className="modal__title">
                {stage === "running" ? "Running…" : "Publish attempts recorded"}
              </div>
              <div className="modal__sub">{item.title}</div>
            </div>
            {stage === "result" && (
              <button className="modal__close" onClick={onClose}>
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
          <div className="modal__body stack-2">
            {outcomes.map((o) => (
              <div key={o.marketplace} className="mp-select__row" style={{ cursor: "default" }}>
                <span style={{ width: 16 }}>
                  {o.status === "running" || o.status === "pending" ? (
                    <span className="badge__dot" style={{ background: "var(--status-publishing-dot)" }} />
                  ) : o.status === "failed" ? (
                    <Icon name="x-c" size={16} style={{ color: "var(--accent)" }} />
                  ) : (
                    <Icon name="info" size={16} style={{ color: "var(--ink-3)" }} />
                  )}
                </span>
                <MpLogo id={o.marketplace} size={36} />
                <div style={{ minWidth: 0 }}>
                  <div className="mp-row__name">{o.name}</div>
                  <div className="mp-row__meta">
                    {o.status === "pending" && "Queued"}
                    {o.status === "running" && "Sending…"}
                    {o.status === "submitted" && "StockX listing submitted"}
                    {o.status === "published" && "Live listing created"}
                    {o.status === "not_implemented" && (o.reason ?? "Not implemented; draft saved")}
                    {o.status === "failed" && (o.reason ?? "Failed")}
                  </div>
                </div>
                <Badge
                  status={
                    o.status === "failed"
                      ? "failed"
                      : o.status === "published"
                        ? "published"
                        : "noimpl"
                  }
                />
              </div>
            ))}
          </div>
          {stage === "result" && (
            <div className="modal__foot">
              <div className="t-small">Attempts are saved to Publish history.</div>
              <Btn variant="primary" onClick={onClose}>
                Done
              </Btn>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
      <span className="t-small muted">{label}</span>
      <span className="t-small" style={{ wordBreak: "break-word", textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}
