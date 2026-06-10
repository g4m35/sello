"use client";

import { useState } from "react";

import { readJsonResponse } from "@/lib/http";
import { getErrorMessage } from "@/lib/errors";
import { Badge, Btn } from "@/components/ui/primitives";
import type { EbayPreflightResult } from "@/lib/marketplace/adapters/ebay/preflight";

// Human wording for the listing-readiness ids the preflight returns.
export const ebayPreflightMissingLabels: Record<string, string> = {
  item_ownership: "Item does not belong to this account",
  title: "Listing title",
  description: "Description",
  price: "Price",
  condition: "Condition",
  categoryId: "eBay category ID",
  photo: "At least one photo",
  quantity: "Valid quantity",
  ebay_connection: "eBay connection (connect in Settings)",
  seller_config: "eBay seller setup (run Refresh Readiness in Settings)",
  paymentPolicyId: "eBay payment policy",
  fulfillmentPolicyId: "eBay fulfillment policy",
  returnPolicyId: "eBay return policy",
  merchantLocationKey: "eBay inventory location",
};

const warningLabels: Record<string, string> = {
  quantity_defaulted_to_1: "No quantity set; the dry run assumes 1.",
};

export function EbayPreflightCard({
  itemId,
  token,
}: {
  itemId: string;
  token: string;
}) {
  const [result, setResult] = useState<EbayPreflightResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runPreflight() {
    setRunning(true);
    setError(null);
    try {
      const payload = await readJsonResponse<EbayPreflightResult>(
        await fetch(`/api/listings/${itemId}/ebay-preflight`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      setResult(payload);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="card">
      <div className="card__head">
        <span className="card__title">eBay publish dry run</span>
        {result && (
          <Badge
            status={result.ready ? "ready" : "draft"}
            label={result.ready ? "Dry run passed" : "Blocked"}
          />
        )}
      </div>
      <div className="card__body stack-4">
        <div className="t-small muted">
          Validates this listing against eBay rules and previews the exact
          payloads Sello would send. Nothing is sent to eBay
          {result?.environment === "production" || result == null
            ? "; production publishing is not enabled yet."
            : "."}
        </div>

        <div className="row" style={{ gap: 8 }}>
          <Btn variant="secondary" size="sm" icon="spark" disabled={running} onClick={runPreflight}>
            {running ? "Checking…" : "Run dry run"}
          </Btn>
          {result && (
            <span className="t-small muted">
              {result.environment === "production"
                ? "Production (publishing disabled)"
                : "Sandbox"}
              {" · "}
              {result.connected ? "eBay connected" : "eBay not connected"}
            </span>
          )}
        </div>

        {result && !result.ready && (
          <div className="stack-4">
            <div className="t-small" style={{ fontWeight: 500 }}>
              Blocking eBay publish:
            </div>
            <ul className="t-small muted" style={{ paddingLeft: 18, margin: 0 }}>
              {result.missing.map((id) => (
                <li key={id}>{ebayPreflightMissingLabels[id] ?? id}</li>
              ))}
            </ul>
          </div>
        )}

        {result?.warnings.map((warning) => (
          <div key={warning} className="t-small muted">
            {warningLabels[warning] ?? warning}
          </div>
        ))}

        {result?.ready && result.preview && (
          <details>
            <summary className="t-small" style={{ cursor: "pointer", fontWeight: 500 }}>
              Preview payloads (SKU {result.preview.sku})
            </summary>
            <pre
              className="t-small"
              style={{
                marginTop: 8,
                maxHeight: 320,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {JSON.stringify(
                {
                  steps: result.preview.steps,
                  inventoryItem: result.preview.inventoryItem,
                  offer: result.preview.offer,
                },
                null,
                2,
              )}
            </pre>
          </details>
        )}

        {error && <div className="t-small" style={{ color: "var(--red, #f87171)" }}>Error: {error}</div>}
      </div>
    </section>
  );
}
