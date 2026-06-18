// Client-only component: imported exclusively from the (client) listing
// editor page, so it inherits the client boundary and may take callbacks.
import { useCallback, useEffect, useRef, useState } from "react";

import { readJsonResponse } from "@/lib/http";
import { getErrorMessage } from "@/lib/errors";
import { Badge, Banner, Btn } from "@/components/ui/primitives";
import type { EbayAspectRequirement } from "@/lib/listing/ebay-aspects";
import type { EbayPreflightResult } from "@/lib/marketplace/adapters/ebay/preflight";
import type {
  EbayCategoryConflict,
  EbayCategoryResolution,
} from "@/lib/listing/intelligence";

/** Anchor id for the "fix eBay details" jump target from the readiness list. */
export const EBAY_DETAILS_ANCHOR = "ebay-required-details";

/** A required aspect with a fixed value list becomes a dropdown, not free text. */
export function aspectControlKind(aspect: Pick<EbayAspectRequirement, "values">): "select" | "text" {
  return aspect.values && aspect.values.length > 0 ? "select" : "text";
}

/** Seller-facing sentence for a category that disagrees with the detected item. */
export function categoryConflictMessage(conflict: EbayCategoryConflict): string {
  return `This looks like a ${conflict.detectedLabel}, but the eBay category is ${conflict.categoryName}. Change category?`;
}

/** Category-specific answers cannot safely carry across an eBay category change. */
export function ebayCategorySelectionPatch(categoryId: string) {
  return { ebayCategoryId: categoryId, ebayAspects: {} };
}

function aspectFieldId(name: string): string {
  return `ebay-aspect-${name.replace(/[^a-z0-9_-]/gi, "-")}`;
}

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
  ebay_public_photo: "eBay-visible listing photo",
  quantity: "Valid quantity",
  sale_wording: "Normal sale wording",
  ebay_connection: "eBay connection (connect in Settings)",
  seller_config: "eBay seller setup (run Refresh Readiness in Settings)",
  paymentPolicyId: "eBay payment policy",
  fulfillmentPolicyId: "eBay fulfillment policy",
  returnPolicyId: "eBay return policy",
  merchantLocationKey: "eBay inventory location",
};

const warningLabels: Record<string, string> = {};

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
  savedQuantity,
  refreshSignal,
  showAdvanced = false,
  onSelectCategory,
  onSaveQuantity,
  onSaveAspect,
}: {
  itemId: string;
  token: string;
  /** Seller-saved eBay category override from the draft (empty when unset). */
  savedCategoryId: string;
  /** Seller-saved eBay quantity; resale listings default to 1. */
  savedQuantity: number;
  /**
   * Increments after every successful draft/item save. Once the seller has run
   * a check, the panel re-checks itself on each bump so eBay readiness stays in
   * sync with the latest saved draft without a manual re-click or page reload.
   */
  refreshSignal?: number;
  /** Show the developer-only payload preview (debug mode). */
  showAdvanced?: boolean;
  /** Persists a category choice through the editor's normal save flow. */
  onSelectCategory: (categoryId: string) => void;
  /** Persists eBay quantity through the editor's normal save flow. */
  onSaveQuantity: (quantity: number) => void;
  /** Persists one eBay item detail (aspect name -> value) via the draft save flow. */
  onSaveAspect: (name: string, value: string) => void;
}) {
  const [result, setResult] = useState<EbayPreflightResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedId, setAdvancedId] = useState("");
  const [quantityDraft, setQuantityDraft] = useState(String(savedQuantity || 1));
  const [aspectDrafts, setAspectDrafts] = useState<Record<string, string>>({});
  const [savedAspectNames, setSavedAspectNames] = useState<string[]>([]);
  // Whether the seller has run at least one check. Gates auto-recheck so the
  // panel never fires a request on first mount (checking is an explicit action).
  const hasChecked = useRef(false);

  const runCheck = useCallback(async () => {
    hasChecked.current = true;
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
      // A fresh check supersedes any per-field "Saved" confirmations.
      setSavedAspectNames([]);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRunning(false);
    }
  }, [itemId, token]);

  // Re-check after each save once the seller has checked at least once, so the
  // eBay readiness panel reflects the latest saved category/quantity/aspects.
  useEffect(() => {
    if (refreshSignal === undefined || !hasChecked.current) return;
    void runCheck();
  }, [refreshSignal, runCheck]);

  const category = result?.category ?? null;
  const categoryConflict = result?.categoryConflict ?? null;
  const needsCategoryChoice = Boolean(
    result && result.missing.includes("ebay_category"),
  );
  // Show the category picker when eBay needs a choice OR the resolved category
  // disagrees with what the item looks like (e.g. a T-shirt in Hoodies).
  const showCategoryPicker =
    (needsCategoryChoice || Boolean(categoryConflict)) &&
    Boolean(category && category.suggestions.length > 0);
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

        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span className="t-small muted">Quantity</span>
          <input
            className="input"
            style={{ width: 80 }}
            inputMode="numeric"
            value={quantityDraft}
            onChange={(e) => setQuantityDraft(e.target.value.replace(/[^\d]/g, ""))}
          />
          <Btn
            variant="secondary"
            size="sm"
            disabled={!/^\d+$/.test(quantityDraft) || Number(quantityDraft) <= 0}
            onClick={() => onSaveQuantity(Number(quantityDraft))}
          >
            Save
          </Btn>
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
              {result.missing.map((id) => {
                const label = ebayPreflightMissingLabels[id] ?? id;
                const anchor =
                  id === "ebay_aspects"
                    ? EBAY_DETAILS_ANCHOR
                    : id === "ebay_category"
                      ? "ebay-category-choice"
                      : null;
                return (
                  <li key={id}>
                    {anchor ? <a href={`#${anchor}`}>{label}</a> : label}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {categoryConflict && (
          <Banner
            variant="warn"
            title="Double-check the eBay category"
            desc={categoryConflictMessage(categoryConflict)}
          />
        )}

        {showCategoryPicker && category && (
          <div className="stack-4" id="ebay-category-choice">
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
                  {suggestion.name}
                </Btn>
              ))}
            </div>
            <div className="t-small muted">
              Your choice saves with the draft and readiness rechecks automatically.
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
          <div className="stack-4" id={EBAY_DETAILS_ANCHOR}>
            <div className="t-small" style={{ fontWeight: 500 }}>
              eBay needs a few item details:
            </div>
            {missingAspects.map((aspect) => {
              const fieldId = aspectFieldId(aspect.name);
              const value = aspectDrafts[aspect.name] ?? "";
              const kind = aspectControlKind(aspect);
              const saved = savedAspectNames.includes(aspect.name);
              const setValue = (next: string) =>
                setAspectDrafts((prev) => ({ ...prev, [aspect.name]: next }));
              const save = () => {
                const trimmed = value.trim();
                if (!trimmed) return;
                onSaveAspect(aspect.name, trimmed);
                setSavedAspectNames((prev) =>
                  prev.includes(aspect.name) ? prev : [...prev, aspect.name],
                );
              };
              return (
                <div key={aspect.name} className="stack-1">
                  <label htmlFor={fieldId} className="t-small" style={{ fontWeight: 500 }}>
                    {aspect.label}
                    {aspect.required ? " (required)" : ""}
                  </label>
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    {kind === "select" ? (
                      <select
                        id={fieldId}
                        className="select"
                        style={{ flex: 1, minWidth: 180, maxWidth: 280 }}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                      >
                        <option value="">{`Choose ${aspect.label.toLowerCase()}…`}</option>
                        {aspect.values!.slice(0, 60).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={fieldId}
                        className="input"
                        style={{ flex: 1, minWidth: 180, maxWidth: 280 }}
                        maxLength={80}
                        placeholder={`Enter ${aspect.label.toLowerCase()}`}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                      />
                    )}
                    <Btn variant="secondary" size="sm" disabled={!value.trim()} onClick={save}>
                      Save
                    </Btn>
                    {saved && (
                      <span className="t-small" style={{ color: "var(--positive)" }}>
                        Saved
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="t-small muted">
              {running
                ? "Checking readiness…"
                : "Saved details persist with the draft and readiness rechecks automatically."}
            </div>
          </div>
        )}

        {result?.warnings.map((warning) => (
          <div key={warning} className="t-small muted">
            {warningLabels[warning] ?? warning}
          </div>
        ))}

        {showAdvanced && result?.ready && result.preview && (
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

        {error && <div className="t-small danger">Error: {error}</div>}
      </div>
    </section>
  );
}
