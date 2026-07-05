"use client";

import { Icon } from "@/components/ui/icon";
import { Badge, Banner, Btn, Check, Modal } from "@/components/ui/primitives";
import type {
  BulkExecutionResult,
  BulkItemResult,
  BulkPreflightItem,
  BulkPreflightResult,
} from "@/lib/marketplace/bulk-publish";

export type BulkPublishPhase = "preflight" | "ready" | "running" | "result";

export type BulkPublishModalProps = {
  open: boolean;
  onClose: () => void;
  selectionCount: number;
  batchLimit: number;
  livePublishAllowed: boolean;
  alphaCopy: string;
  phase: BulkPublishPhase;
  preflight: BulkPreflightResult | null;
  execution: BulkExecutionResult | null;
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
    name: "eBay",
    confirm: "I understand this will create live eBay listings.",
    titleLive: "Publish selected to eBay",
    titlePreview: "Preview selected for eBay",
    alreadyListed: "Already listed on eBay",
    readyMeta: "Ready to publish",
    liveButton: (count: number) => `Publish ${count} to eBay`,
  },
  stockx: {
    name: "StockX",
    confirm: "I understand this will create live StockX listings.",
    titleLive: "Publish selected to StockX",
    titlePreview: "Preview selected for StockX",
    alreadyListed: "Already has a StockX listing",
    readyMeta: "Exact product and size ready",
    liveButton: (count: number) => `Publish ${count} to StockX`,
  },
} as const;

const PREFLIGHT_LABEL: Record<BulkPreflightItem["status"], string> = {
  ready: "Ready",
  needs_details: "Needs details",
  skipped: "Already listed",
  rejected: "Unavailable",
};

function preflightMeta(status: BulkPreflightItem["status"], marketplace: "ebay" | "stockx") {
  if (status === "ready") return MARKETPLACE_COPY[marketplace].readyMeta;
  if (status === "skipped") return MARKETPLACE_COPY[marketplace].alreadyListed;
  return PREFLIGHT_META[status];
}

const PREFLIGHT_META: Record<Exclude<BulkPreflightItem["status"], "ready" | "skipped">, string> = {
  needs_details: "Missing required details",
  rejected: "Not available",
};

const RESULT_LABEL: Record<BulkItemResult["status"], string> = {
  published: "Published",
  skipped: "Skipped",
  needs_details: "Needs details",
  failed: "Failed",
};

function CountChips({ chips }: { chips: [string, number][] }) {
  const shown = chips.filter(([, n]) => n > 0);
  const display = shown.length ? shown : [["Ready", 0] as [string, number]];
  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      {display.map(([label, n]) => (
        <Badge key={label} outline label={`${label} ${n}`} />
      ))}
    </div>
  );
}

export function BulkPublishModal({
  open,
  onClose,
  selectionCount,
  batchLimit,
  livePublishAllowed,
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
}: BulkPublishModalProps) {
  const copy = MARKETPLACE_COPY[marketplace];
  const title = (id: string) => itemTitles?.[id] ?? "Selected item";
  const closeAllowed = phase !== "running";
  const readyCount = preflight?.readyCount ?? 0;

  return (
    <Modal open={open} onClose={closeAllowed ? onClose : undefined} wide>
      <div className="modal__head">
        <div>
          <div className="modal__title">
            {livePublishAllowed ? copy.titleLive : copy.titlePreview}
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

        {!livePublishAllowed && (
          <Banner variant="info" title="Preview only" desc={alphaCopy} />
        )}

        {phase === "preflight" && (
          <div className="t-small muted">Checking {selectionCount} selected items…</div>
        )}

        {(phase === "ready" || phase === "running") && preflight && (
          <>
            <CountChips
              chips={[
                ["Ready", preflight.readyCount],
                ["Needs details", preflight.needsDetailsCount],
                ["Already listed", preflight.skippedCount],
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
                    <div className="mp-row__meta">
                      {row.status === "needs_details" && row.missing?.length
                        ? `Needs: ${row.missing.join(", ")}`
                        : preflightMeta(row.status, marketplace)}
                    </div>
                  </div>
                  <Badge outline label={PREFLIGHT_LABEL[row.status]} />
                </div>
              ))}
            </div>
            {livePublishAllowed && phase === "ready" && (
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
                ["Published", execution.publishedCount],
                ["Needs details", execution.needsDetailsCount],
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
          {livePublishAllowed && phase === "ready" && (
            <Btn
              variant="accent"
              disabled={!confirmLive || readyCount === 0}
              onClick={onExecute}
            >
              {copy.liveButton(readyCount)}
            </Btn>
          )}
        </div>
      </div>
    </Modal>
  );
}
