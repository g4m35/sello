"use client";

import { Icon } from "@/components/ui/icon";
import { Badge, Banner, Btn } from "@/components/ui/primitives";
import { MpLogo } from "@/components/ui/marketplace";
import type { FeatureAccess } from "@/lib/auth/feature-access";
import { durationLabel, relativeTime } from "@/lib/view/format";
import {
  ebayChannelUrl,
  isLiveEbayChannel,
  isLiveStockXChannel,
  resolveDelistAction,
  stockxChannelUrl,
} from "@/lib/view/inventory-actions";
import { marketplaceName } from "@/lib/view/marketplaces";
import { DESIGN_STATUS_LABEL } from "@/lib/view/status";
import type {
  AttemptView,
  ChannelStateView,
  DesignStatus,
  EbayOrphanArtifactView,
} from "@/lib/view/types";

const DENIED_FEATURE_ACCESS: FeatureAccess = {
  liveEbayPublish: false,
  ebayDelist: false,
  paidComps: false,
  etsyConnect: false,
  etsyPublish: false,
  etsyDelist: false,
  etsyOrders: false,
};

const DEFAULT_DELIST_ALPHA_COPY =
  "Live eBay delisting is currently enabled for selected alpha accounts.";

function titleCase(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}

export type SellerPublishStatus = {
  /** Short seller-facing status word. */
  label: string;
  /** Badge tone (design status). */
  tone: DesignStatus;
  /** One plain-language sentence: what this means. */
  meaning: string;
  /** What the seller should do next. */
  nextAction: string;
};

/**
 * Maps the technical eBay channel state to a seller-facing status, plain-language
 * meaning, and next action. No SKUs, offer/listing ids, or raw errors.
 */
export function sellerPublishStatus(channel: ChannelStateView | null): SellerPublishStatus {
  if (!channel) {
    return {
      label: "Not listed",
      tone: "draft",
      meaning: "This item has not been sent to eBay.",
      nextAction: "Finish the listing details, then preview the eBay payload.",
    };
  }
  switch (channel.status) {
    case "published":
      return {
        label: "Published",
        tone: "published",
        meaning: "This item is live on eBay.",
        nextAction: "Manage or end the listing below.",
      };
    case "publishing":
      return {
        label: "Publishing",
        tone: "publishing",
        meaning: "This item is being sent to eBay.",
        nextAction: "Hang tight while eBay confirms the listing.",
      };
    case "delisted":
      return {
        label: "Ended",
        tone: "delisted",
        meaning: "This eBay listing has ended.",
        nextAction: "Duplicate the draft to relist it.",
      };
    case "failed":
      return {
        label: "Error",
        tone: "failed",
        meaning: "The last publish attempt ran into a problem.",
        nextAction: "Fix the flagged details and try again.",
      };
    case "ready":
      return channel.publishImplemented
        ? {
            label: "Ready to publish",
            tone: "ready",
            meaning: "This item is ready to send to eBay.",
            nextAction: "Use Publish to eBay, or preview the payload first.",
          }
        : {
            label: "Publish disabled",
            tone: "ready",
            meaning: "This item is ready, but production publishing is currently disabled.",
            nextAction: "Preview the eBay payload, or copy/export to list it manually.",
          };
    default:
      return channel.publishImplemented
        ? {
            label: "Draft only",
            tone: "draft",
            meaning: "This item still needs details before it can be published.",
            nextAction: "Finish the readiness checklist above.",
          }
        : {
            label: "Draft only",
            tone: "draft",
            meaning:
              "This item has not been sent to eBay, and production publishing is currently disabled.",
            nextAction: "Finish the details, then preview the eBay payload or copy/export.",
          };
  }
}

function attemptDisplay(attempt: AttemptView): { status: DesignStatus; label: string } {
  if (attempt.rawStatus === "SUCCEEDED" && attempt.code?.startsWith("EBAY_ORPHAN_CLEANUP")) {
    return { status: "ready", label: "Cleanup complete" };
  }
  return { status: attempt.status, label: DESIGN_STATUS_LABEL[attempt.status] };
}

export function confirmEbayDelist(
  confirmFn: (message: string) => boolean = window.confirm,
): boolean {
  return confirmFn(
    "This ends the live eBay listing. The item will no longer be available on eBay after eBay confirms the request.",
  );
}

export function confirmStockXDelist(
  confirmFn: (message: string) => boolean = window.confirm,
): boolean {
  return confirmFn(
    "This ends the live StockX listing operation. The item will no longer be available on StockX after StockX confirms the request.",
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
  delistingStockX = false,
  orphanScan,
  scanningOrphans,
  cleaningOrphans,
  showAdvanced = false,
  featureAccess = DENIED_FEATURE_ACCESS,
  delistAlphaCopy = DEFAULT_DELIST_ALPHA_COPY,
  onDelistEbay,
  onDelistStockX,
  onScanEbayOrphans,
  onCleanupEbayOrphans,
}: {
  channels: ChannelStateView[];
  attempts: AttemptView[];
  delisting: boolean;
  delistingStockX?: boolean;
  orphanScan: EbayOrphanArtifactView | null;
  scanningOrphans: boolean;
  cleaningOrphans: boolean;
  /**
   * Show developer/admin diagnostics (SKU, offer/listing ids, orphan recovery,
   * raw errors). Off for normal sellers; enabled via debug mode.
   */
  showAdvanced?: boolean;
  /** Seller's resolved feature entitlements (gates the live delist action). */
  featureAccess?: FeatureAccess;
  /** Alpha copy shown when a live listing exists but delist is not entitled. */
  delistAlphaCopy?: string;
  onDelistEbay: () => void;
  onDelistStockX?: () => void;
  onScanEbayOrphans: () => void;
  onCleanupEbayOrphans: () => void;
}) {
  const latestAttempt = attempts[0] ?? null;
  const latestAttemptDisplay = latestAttempt ? attemptDisplay(latestAttempt) : null;
  const ebay = channels.find((channel) => channel.marketplace === "ebay") ?? null;
  const stockx = channels.find((channel) => channel.marketplace === "stockx") ?? null;
  const status = sellerPublishStatus(ebay);
  const liveListing = isLiveEbayChannel(ebay);
  const delistAction = resolveDelistAction(ebay, featureAccess);
  const liveUrl = ebayChannelUrl(ebay);
  const stockxLive = isLiveStockXChannel(stockx);
  const stockxLiveUrl = stockxChannelUrl(stockx);
  const lastError =
    latestAttempt?.reason || latestAttempt?.listingLastError || ebay?.lastError || null;

  return (
    <section className="card">
      <div className="card__head">
        <span className="card__title">Publishing</span>
        <span className="t-small muted">
          {latestAttempt ? `Last attempt ${relativeTime(latestAttempt.time)}` : "Not sent to eBay yet"}
        </span>
      </div>
      <div className="card__body stack-4">
        <div className="row" style={{ gap: 12 }}>
          <MpLogo id="ebay" size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mp-row__name">eBay</div>
            <div className="mp-row__meta">
              {titleCase(ebay?.environment)} · {status.label}
            </div>
          </div>
          <Badge status={status.tone} label={status.label} />
        </div>

        <div className="stack-1">
          <div className="t-small">{status.meaning}</div>
          <div className="t-small muted">Next: {status.nextAction}</div>
        </div>

        {(liveUrl || delistAction.available || delistAction.restricted) && (
          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            {liveUrl && (
              <a
                className="btn btn--secondary btn--sm"
                href={liveUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="external" size={13} /> View live
              </a>
            )}
            {delistAction.available && (
              <Btn
                variant="secondary"
                size="sm"
                icon="x-c"
                disabled={delisting}
                onClick={onDelistEbay}
              >
                {delisting ? "Ending..." : delistAction.label}
              </Btn>
            )}
          </div>
        )}

        {delistAction.restricted && (
          <Banner
            variant="info"
            title="Ending eBay listings is in alpha"
            desc={delistAlphaCopy}
          />
        )}

        {stockx && stockx.status !== "draft" && (
          <div className="stack-3" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <div className="row" style={{ gap: 12 }}>
              <MpLogo id="stockx" size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mp-row__name">StockX</div>
                <div className="mp-row__meta">
                  {titleCase(stockx.environment)} · {titleCase(stockx.status)}
                </div>
              </div>
              <Badge status={stockx.status} />
            </div>
            <div className="t-small">
              {stockxLive
                ? "This item has a StockX listing operation managed by Sello."
                : "This StockX listing is not currently active."}
            </div>
            {(stockxLiveUrl || (stockxLive && onDelistStockX)) && (
              <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                {stockxLiveUrl && (
                  <a
                    className="btn btn--secondary btn--sm"
                    href={stockxLiveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Icon name="external" size={13} /> View StockX
                  </a>
                )}
                {stockxLive && onDelistStockX && (
                  <Btn
                    variant="secondary"
                    size="sm"
                    icon="x-c"
                    disabled={delistingStockX}
                    onClick={onDelistStockX}
                  >
                    {delistingStockX ? "Ending..." : "End StockX listing"}
                  </Btn>
                )}
              </div>
            )}
          </div>
        )}

        {showAdvanced && (
          <details className="stack-2">
            <summary className="t-small muted" style={{ cursor: "pointer" }}>
              Advanced eBay diagnostics
            </summary>
            <div className="stack-4" style={{ marginTop: 8 }}>
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
                      {latestAttempt.marketplaceName} · {latestAttemptDisplay?.label}
                    </div>
                    <div className="mp-row__meta">
                      {titleCase(latestAttempt.environment)} · {relativeTime(latestAttempt.time)} ·{" "}
                      {durationLabel(latestAttempt.durationMs)}
                    </div>
                    <div className="mp-row__action">
                      <Badge
                        status={latestAttemptDisplay?.status}
                        label={latestAttemptDisplay?.label}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="t-small muted">No publish attempts yet.</div>
              )}

              {lastError && (
                <Banner variant="warn" title="Last marketplace error" desc={lastError} />
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
                    {attempts.slice(1, 8).map((attempt) => {
                      const display = attemptDisplay(attempt);
                      return (
                        <div key={attempt.id} className="mp-row">
                          <MpLogo id={attempt.marketplace} size={24} />
                          <div className="mp-row__name">
                            {marketplaceName(attempt.marketplace)} · {display.label}
                          </div>
                          <div className="mp-row__meta">
                            {titleCase(attempt.environment)} · {relativeTime(attempt.time)}
                          </div>
                          <div className="mp-row__action">
                            <Badge status={display.status} label={display.label} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}

              {!liveListing && (
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
                        value={
                          orphanScan.liveListingFound
                            ? "Possible live listing found"
                            : "Not found"
                        }
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
          </details>
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
