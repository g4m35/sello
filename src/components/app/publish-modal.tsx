"use client";

import { useState } from "react";

import { Icon } from "@/components/ui/icon";
import { Badge, Banner, Btn, Check, Modal } from "@/components/ui/primitives";
import { MpLogo } from "@/components/ui/marketplace";
import { api } from "@/lib/api/client";
import { useSession } from "@/components/providers/session-provider";
import { formatMoneyCents } from "@/lib/view/format";
import type { ItemView } from "@/lib/view/types";

type Stage = "review" | "running" | "result";

type Outcome = {
  marketplace: string;
  name: string;
  status: "pending" | "running" | "published" | "not_implemented" | "failed";
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
  const [stage, setStage] = useState<Stage>("review");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);

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
    }
  }

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
        });
        const outcome: Outcome = {
          marketplace: c.marketplace,
          name: c.name,
          status: res.status === "published" ? "published" : "not_implemented",
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
  const selectedLiveEbay = item.channels.some(
    (c) => c.marketplace === "ebay" && c.publishImplemented && selected.has(c.marketplace),
  );

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
            <Banner
              variant="warn"
              title={
                selectedLiveEbay
                  ? "Final eBay publish review"
                  : "Publishing isn't enabled yet"
              }
              desc={
                selectedLiveEbay
                  ? "Confirming creates a live eBay listing. Sello will run the readiness preflight again before sending anything to eBay."
                  : "Listings stay draft-only. Running publish records a real, audited attempt per channel and returns each marketplace's not-implemented status; nothing is sent to any marketplace."
              }
            />
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
              <Btn variant="accent" disabled={selectedCount === 0} onClick={run}>
                {selectedLiveEbay
                  ? "Create live eBay listing"
                  : `Record publish attempt (${selectedCount})`}
              </Btn>
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
