"use client";

import { Badge, Banner, Btn } from "@/components/ui/primitives";
import { MpLogo } from "@/components/ui/marketplace";
import { durationLabel, relativeTime } from "@/lib/view/format";
import { marketplaceName } from "@/lib/view/marketplaces";
import { DESIGN_STATUS_LABEL } from "@/lib/view/status";
import type {
  AttemptView,
  ChannelStateView,
  EbayOrphanArtifactView,
} from "@/lib/view/types";

function titleCase(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}

function operationsStatus(channel: ChannelStateView | null): string {
  if (!channel) return "Draft";
  if (channel.status === "ready") return "Ready";
  if (channel.status === "publishing") return "Publishing";
  if (channel.status === "published") return "Published";
  if (channel.status === "failed") return "Failed";
  return "Draft";
}

export function confirmEbayDelist(
  confirmFn: (message: string) => boolean = window.confirm,
): boolean {
  return confirmFn(
    "This ends the live eBay listing. The item will no longer be available on eBay after eBay confirms the request.",
  );
}

export function confirmEbayOrphanCleanup(
  confirmFn: (message: string) => boolean = window.confirm,
): boolean {
  return confirmFn(
    "This removes unpublished eBay inventory or offer artifacts for this SKU. It will not continue if a live eBay listing is detected.",
  );
}

export function MarketplaceOperationsPanel({
  channels,
  attempts,
  delisting,
  orphanScan,
  scanningOrphans,
  cleaningOrphans,
  onDelistEbay,
  onScanEbayOrphans,
  onCleanupEbayOrphans,
}: {
  channels: ChannelStateView[];
  attempts: AttemptView[];
  delisting: boolean;
  orphanScan: EbayOrphanArtifactView | null;
  scanningOrphans: boolean;
  cleaningOrphans: boolean;
  onDelistEbay: () => void;
  onScanEbayOrphans: () => void;
  onCleanupEbayOrphans: () => void;
}) {
  const latestAttempt = attempts[0] ?? null;
  const ebay = channels.find((channel) => channel.marketplace === "ebay") ?? null;
  const canDelistEbay =
    ebay?.status === "published" &&
    Boolean(ebay.externalOfferId) &&
    Boolean(ebay.externalListingId);
  const lastError =
    latestAttempt?.reason || latestAttempt?.listingLastError || ebay?.lastError || null;

  return (
    <section className="card">
      <div className="card__head">
        <span className="card__title">Publish operations</span>
        <span className="t-small muted">
          {latestAttempt ? "Latest attempt" : "No attempts yet"}
        </span>
      </div>
      <div className="card__body stack-4">
        <div className="row" style={{ gap: 12 }}>
          <MpLogo id="ebay" size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mp-row__name">eBay</div>
            <div className="mp-row__meta">
              {titleCase(ebay?.environment)} · {operationsStatus(ebay)}
            </div>
          </div>
          <Badge status={ebay?.status ?? "draft"} />
        </div>

        {ebay && (
          <div className="stack-2">
            <Identifier label="SKU" value={ebay.sku} />
            <Identifier label="Offer ID" value={ebay.externalOfferId} />
            <Identifier label="Listing ID" value={ebay.externalListingId} />
          </div>
        )}

        {latestAttempt ? (
          <div className="stack-2">
            <div className="t-small muted">Latest attempt</div>
            <div className="mp-row">
              <MpLogo id={latestAttempt.marketplace} size={28} />
              <div className="mp-row__name">
                {latestAttempt.marketplaceName} · {DESIGN_STATUS_LABEL[latestAttempt.status]}
              </div>
              <div className="mp-row__meta">
                {titleCase(latestAttempt.environment)} · {relativeTime(latestAttempt.time)} ·{" "}
                {durationLabel(latestAttempt.durationMs)}
              </div>
              <div className="mp-row__action">
                <Badge status={latestAttempt.status} />
              </div>
            </div>
          </div>
        ) : (
          <div className="t-small muted">No publish attempts yet.</div>
        )}

        {lastError && (
          <Banner
            variant="warn"
            title="Last marketplace error"
            desc={lastError}
          />
        )}

        {latestAttempt?.failedStep && (
          <div className="stack-2">
            <Identifier label="Failed step" value={latestAttempt.failedStep} />
            <Identifier
              label="eBay status"
              value={
                latestAttempt.ebayErrorStatus == null
                  ? null
                  : String(latestAttempt.ebayErrorStatus)
              }
            />
            <Identifier label="eBay reason" value={latestAttempt.ebayErrorMessage} />
          </div>
        )}

        {attempts.length > 1 && (
          <details>
            <summary className="t-small muted" style={{ cursor: "pointer" }}>
              Show publish history
            </summary>
            <div className="stack-2" style={{ marginTop: 8 }}>
              {attempts.slice(1, 8).map((attempt) => (
                <div key={attempt.id} className="mp-row">
                  <MpLogo id={attempt.marketplace} size={24} />
                  <div className="mp-row__name">
                    {marketplaceName(attempt.marketplace)} ·{" "}
                    {DESIGN_STATUS_LABEL[attempt.status]}
                  </div>
                  <div className="mp-row__meta">
                    {titleCase(attempt.environment)} · {relativeTime(attempt.time)}
                  </div>
                  <div className="mp-row__action">
                    <Badge status={attempt.status} />
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

        {canDelistEbay && (
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Btn
              variant="secondary"
              size="sm"
              icon="x-c"
              disabled={delisting}
              onClick={onDelistEbay}
            >
              {delisting ? "Ending..." : "End eBay listing"}
            </Btn>
          </div>
        )}

        {!canDelistEbay && (
          <div className="stack-3">
            <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div className="t-small">eBay orphan recovery</div>
                <div className="t-small muted">
                  Read-only check for unpublished inventory or offer artifacts.
                </div>
              </div>
              <Btn
                variant="secondary"
                size="sm"
                icon="search"
                disabled={scanningOrphans}
                onClick={onScanEbayOrphans}
              >
                {scanningOrphans
                  ? "Checking..."
                  : "Check for eBay orphan publish artifacts"}
              </Btn>
            </div>

            {orphanScan && (
              <div className="stack-2">
                <Identifier label="Checked SKU" value={orphanScan.sku} />
                <Identifier
                  label="Inventory item"
                  value={orphanScan.inventoryItemFound ? "Found" : "Not found"}
                />
                <Identifier
                  label="Offer IDs"
                  value={
                    orphanScan.offers.length > 0
                      ? orphanScan.offers
                          .map((offer) => offer.offerId ?? "unknown offer")
                          .join(", ")
                      : "Not found"
                  }
                />
                <Identifier
                  label="Live listing"
                  value={orphanScan.liveListingFound ? "Possible live listing found" : "Not found"}
                />
                {orphanScan.cleanupAvailable && (
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    <Btn
                      variant="secondary"
                      size="sm"
                      icon="trash"
                      disabled={cleaningOrphans}
                      onClick={onCleanupEbayOrphans}
                    >
                      {cleaningOrphans
                        ? "Cleaning..."
                        : "Clean up unpublished eBay artifacts"}
                    </Btn>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Identifier({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
      <span className="t-small muted">{label}</span>
      <span className="t-mono t-small" style={{ wordBreak: "break-all", textAlign: "right" }}>
        {value ?? "Not stored"}
      </span>
    </div>
  );
}
