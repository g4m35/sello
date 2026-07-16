"use client";

import { Icon } from "@/components/ui/icon";
import { Badge, Banner, Btn, Check, Modal } from "@/components/ui/primitives";
import type {
  BulkDelistExecutionResult,
  BulkDelistItemResult,
  BulkDelistPreflightItem,
  BulkDelistPreflightResult,
} from "@/lib/marketplace/bulk-delist";

export type BulkDelistPhase = "preflight" | "ready" | "running" | "result";

export type BulkDelistModalProps = {
  open: boolean;
  onClose: () => void;
  selectionCount: number;
  batchLimit: number;
  liveDelistAllowed: boolean;
  alphaCopy: string;
  phase: BulkDelistPhase;
  preflight: BulkDelistPreflightResult | null;
  execution: BulkDelistExecutionResult | null;
  confirmLive: boolean;
  onConfirmChange: (next: boolean) => void;
  onExecute: () => void;
  onRetry?: (itemIds: string[]) => void;
  error?: string | null;
  itemTitles?: Record<string, string>;
  marketplace?: "ebay" | "stockx";
};

const MARKETPLACE_COPY = {
  ebay: {
    titleLive: "End selected on eBay",
    titlePreview: "Review selected for ending",
    confirm: "I understand this ends these live eBay listings.",
    eligibleMeta: "Live on eBay — can be ended",
    notListedMeta: "No live eBay listing",
    alreadyEndedMeta: "Already ended on eBay",
    liveButton: (count: number) => `End ${count} on eBay`,
  },
  stockx: {
    titleLive: "Delist selected from StockX",
    titlePreview: "Review selected for StockX delist",
    confirm: "I understand this will delist these items from StockX.",
    eligibleMeta: "Live or submitted on StockX — can be delisted",
    notListedMeta: "No active StockX listing",
    alreadyEndedMeta: "Already delisted from StockX",
    liveButton: (count: number) => `Delist ${count} from StockX`,
  },
} as const;

const PREFLIGHT_LABEL: Record<BulkDelistPreflightItem["status"], string> = {
  eligible: "Can end",
  not_listed: "Not live",
  already_ended: "Already ended",
  in_flight: "Ending…",
  rejected: "Unavailable",
};

function preflightMeta(status: BulkDelistPreflightItem["status"], marketplace: "ebay" | "stockx") {
  const copy = MARKETPLACE_COPY[marketplace];
  if (status === "eligible") return copy.eligibleMeta;
  if (status === "not_listed") return copy.notListedMeta;
  if (status === "already_ended") return copy.alreadyEndedMeta;
  return PREFLIGHT_META[status];
}

const PREFLIGHT_META: Record<Exclude<BulkDelistPreflightItem["status"], "eligible" | "not_listed" | "already_ended">, string> = {
  in_flight: "An end is already in progress",
  rejected: "Not available",
};

const RESULT_LABEL: Record<BulkDelistItemResult["status"], string> = {
  ended: "Ended",
  skipped: "Skipped",
  failed: "Failed",
};

function CountChips({ chips }: { chips: [string, number][] }) {
  const shown = chips.filter(([, n]) => n > 0);
  const display = shown.length ? shown : [["Can end", 0] as [string, number]];
  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      {display.map(([label, n]) => (
        <Badge key={label} outline label={`${label} ${n}`} />
      ))}
    </div>
  );
}

export function BulkDelistModal({
  open,
  onClose,
  selectionCount,
  batchLimit,
  liveDelistAllowed,
  alphaCopy,
  phase,
  preflight,
  execution,
  confirmLive,
  onConfirmChange,
  onExecute,
  onRetry,
  error,
  itemTitles,
  marketplace = "ebay",
}: BulkDelistModalProps) {
  const copy = MARKETPLACE_COPY[marketplace];
  const title = (id: string) => itemTitles?.[id] ?? "Selected item";
  const closeAllowed = phase !== "running";
  const eligibleCount = preflight?.eligibleCount ?? 0;

  return (
    <Modal open={open} onClose={closeAllowed ? onClose : undefined} wide>
      <div className="modal__head">
        <div>
          <div className="modal__title">
            {liveDelistAllowed ? copy.titleLive : copy.titlePreview}
          </div>
          <div className="modal__sub">
            {selectionCount} selected item{selectionCount === 1 ? "" : "s"}
          </div>
        </div>
        {closeAllowed && (
          <button className="modal__close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        )}
      </div>

      <div className="modal__body stack-4">
        {error && <Banner variant="error" title="Something went wrong" desc={error} />}

        {!liveDelistAllowed && (
          <Banner variant="info" title="Review only" desc={alphaCopy} />
        )}

        {phase === "preflight" && (
          <div className="t-small muted">Checking {selectionCount} selected items…</div>
        )}

        {(phase === "ready" || phase === "running") && preflight && (
          <>
            <CountChips
              chips={[
                ["Can end", preflight.eligibleCount],
                ["Not live", preflight.notListedCount],
                ["Already ended", preflight.alreadyEndedCount],
                ["Ending", preflight.inFlightCount],
                ["Unavailable", preflight.rejectedCount],
              ]}
            />
            <div className="stack-2">
              {preflight.items.map((row) => (
                <div
                  key={row.itemId}
                  className="mp-select__row"
                  style={{ cursor: "default" }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="mp-row__name">{title(row.itemId)}</div>
                    <div className="mp-row__meta">{preflightMeta(row.status, marketplace)}</div>
                  </div>
                  <Badge outline label={PREFLIGHT_LABEL[row.status]} />
                </div>
              ))}
            </div>
            {liveDelistAllowed && phase === "ready" && (
              <label
                className="row"
                style={{ gap: 8, alignItems: "center", cursor: "pointer" }}
              >
                <Check checked={confirmLive} onChange={() => onConfirmChange(!confirmLive)} />
                <span className="t-small">{copy.confirm}</span>
              </label>
            )}
          </>
        )}

        {phase === "result" && execution && (
          <>
            <CountChips
              chips={[
                ["Ended", execution.endedCount],
                ["Skipped", execution.skippedCount],
                ["Failed", execution.failedCount],
              ]}
            />
            <div className="stack-2">
              {execution.items.map((it) => (
                <div key={it.itemId} className="mp-select__row" style={{ cursor: "default" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="mp-row__name">{title(it.itemId)}</div>
                    <div className="mp-row__meta">{it.message}</div>
                  </div>
                  <Badge outline label={RESULT_LABEL[it.status]} />
                  {it.retrySafe && onRetry && (
                    <Btn variant="secondary" size="sm" onClick={() => onRetry([it.itemId])}>
                      Retry
                    </Btn>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="modal__foot">
        <div className="t-small">
          {phase === "result"
            ? "Results stay here until you close."
            : `${selectionCount} selected · Plan limit ${batchLimit}`}
        </div>
        <div className="row">
          <Btn variant="ghost" onClick={onClose} disabled={!closeAllowed}>
            {phase === "result" ? "Close" : "Cancel"}
          </Btn>
          {liveDelistAllowed && phase === "ready" && (
            <Btn
              variant="accent"
              disabled={!confirmLive || eligibleCount === 0}
              onClick={onExecute}
            >
              {copy.liveButton(eligibleCount)}
            </Btn>
          )}
        </div>
      </div>
    </Modal>
  );
}
