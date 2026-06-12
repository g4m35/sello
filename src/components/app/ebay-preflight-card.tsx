// Client-only component: imported exclusively from the (client) listing
// editor page, so it inherits the client boundary and may take callbacks.
import { useState } from "react";

import { readJsonResponse } from "@/lib/http";
import { getErrorMessage } from "@/lib/errors";
import { Badge, Btn } from "@/components/ui/primitives";
import type { EbayPreflightResult } from "@/lib/marketplace/adapters/ebay/preflight";
import type { EbayCategoryResolution } from "@/lib/listing/intelligence";

// Human wording for the listing-readiness ids the preflight returns.
export const ebayPreflightMissingLabels: Record<string, string> = {
  item_ownership: "Item does not belong to this account",
  title: "Listing title",
  description: "Description",
  price: "Price",
  condition: "Condition",
  ebay_category: "Choose an eBay category",
  ebay_aspects: "A few item details (below)",
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
  quantity_defaulted_to_1: "No quantity set; listing as 1.",
};

const confidenceLabels: Record<EbayCategoryResolution["confidence"], string> = {
  high: "high confidence",
  medium: "needs review",
  low: "needs your choice",
  none: "no suggestion",
};

export function EbayPreflightCard({
  itemId,
  token,
  savedCategoryId,
  onSelectCategory,
  onSaveAspect,
}: {
  itemId: string;
  token: string;
  /** Seller-saved eBay category override from the draft (empty when unset). */
  savedCategoryId: string;
  /** Persists a category choice through the editor's normal save flow. */
  onSelectCategory: (categoryId: string) => void;
  /** Persists one eBay item detail (aspect name -> value) via the draft save flow. */
  onSaveAspect: (name: string, value: string) => void;
}) {
  const [result, setResult] = useState<EbayPreflightResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedId, setAdvancedId] = useState("");
  const [aspectDrafts, setAspectDrafts] = useState<Record<string, string>>({});

  async function runCheck() {
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

  const category = result?.category ?? null;
  const needsCategoryChoice = Boolean(
    result && result.missing.includes("ebay_category"),
  );
  const missingAspects = result?.aspects.missingRequired ?? [];

  return (
    <section className="card">
      <div className="card__head">
        <span className="card__title">eBay publish readiness</span>
        {result && (
          <Badge
            status={result.ready ? "ready" : "draft"}
            label={result.ready ? "Ready for eBay" : "Needs review"}
          />
        )}
      </div>
      <div className="card__body stack-4">
        <div className="t-small muted">
          Checks everything eBay needs and previews exactly what Sello would
          send. Nothing is sent to eBay; production publishing is not enabled
          yet.
        </div>

        <div className="row" style={{ gap: 8 }}>
          <Btn variant="secondary" size="sm" icon="spark" disabled={running} onClick={runCheck}>
            {running ? "Checking..." : "Check eBay readiness"}
          </Btn>
          {result && (
            <span className="t-small muted">
              {result.connected ? "eBay connected" : "eBay not connected"}
              {" / "}Quantity: {result.quantity}
            </span>
          )}
        </div>

        {category?.resolvedId && (
          <div className="t-small muted">
            eBay category:{" "}
            <span style={{ fontWeight: 500 }}>
              {category.resolvedName ?? "Custom"} / {category.resolvedId}
            </span>{" "}
            ({category.source === "saved" ? "your choice" : "inferred, "}
            {category.source === "saved" ? "" : confidenceLabels[category.confidence]})
          </div>
        )}

        {result && !result.ready && (
          <div className="stack-4">
            <div className="t-small" style={{ fontWeight: 500 }}>
              Needed before eBay publish:
            </div>
            <ul className="t-small muted" style={{ paddingLeft: 18, margin: 0 }}>
              {result.missing.map((id) => (
                <li key={id}>{ebayPreflightMissingLabels[id] ?? id}</li>
              ))}
            </ul>
          </div>
        )}

        {needsCategoryChoice && category && category.suggestions.length > 0 && (
          <div className="stack-4">
            <div className="t-small" style={{ fontWeight: 500 }}>
              Choose an eBay category:
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {category.suggestions.map((suggestion) => (
                <Btn
                  key={suggestion.id}
                  variant={savedCategoryId === suggestion.id ? "accent" : "secondary"}
                  size="sm"
                  onClick={() => onSelectCategory(suggestion.id)}
                >
                  {suggestion.name} / {suggestion.id}
                </Btn>
              ))}
            </div>
            <div className="t-small muted">
              Your choice saves with the draft; check readiness again after picking.
            </div>
          </div>
        )}

        {needsCategoryChoice && category && category.suggestions.length === 0 && (
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <span className="t-small muted">Advanced: eBay category ID</span>
            <input
              className="input"
              style={{ width: 120 }}
              inputMode="numeric"
              placeholder="e.g. 15709"
              value={advancedId}
              onChange={(e) => setAdvancedId(e.target.value)}
            />
            <Btn
              variant="secondary"
              size="sm"
              disabled={!/^\d{1,32}$/.test(advancedId.trim())}
              onClick={() => onSelectCategory(advancedId.trim())}
            >
              Use ID
            </Btn>
          </div>
        )}

        {missingAspects.length > 0 && (
          <div className="stack-4">
            <div className="t-small" style={{ fontWeight: 500 }}>
              eBay needs a few item details:
            </div>
            {missingAspects.map((aspect) => (
              <div key={aspect.name} className="row" style={{ gap: 8, alignItems: "center" }}>
                <span className="t-small muted" style={{ width: 180 }}>
                  {aspect.label}
                </span>
                <input
                  className="input"
                  style={{ flex: 1, maxWidth: 220 }}
                  maxLength={80}
                  value={aspectDrafts[aspect.name] ?? ""}
                  onChange={(e) =>
                    setAspectDrafts((prev) => ({
                      ...prev,
                      [aspect.name]: e.target.value,
                    }))
                  }
                />
                <Btn
                  variant="secondary"
                  size="sm"
                  disabled={!(aspectDrafts[aspect.name] ?? "").trim()}
                  onClick={() =>
                    onSaveAspect(aspect.name, (aspectDrafts[aspect.name] ?? "").trim())
                  }
                >
                  Save
                </Btn>
              </div>
            ))}
            <div className="t-small muted">
              Saved details persist with the draft; check readiness again after filling.
            </div>
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
              Technical preview (SKU {result.preview.sku})
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
