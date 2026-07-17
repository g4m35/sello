"use client";

import { useState } from "react";

import { api } from "@/lib/api/client";
import { Banner, Btn } from "@/components/ui/primitives";
import { MpLogo } from "@/components/ui/marketplace";
import { Field } from "@/components/ui/form";
import { marketplaceName } from "@/lib/view/marketplaces";
import type { ExportMarketplace } from "@/lib/marketplace/export-formatters";
import {
  guidedListingMeta,
  isPlausibleListingUrl,
} from "@/lib/marketplace/guided-listing";

type ExportPayload = {
  title: string;
  body: string;
  fields: { key: string; label: string; value: string }[];
  warnings: string[];
};

export type GuidedListingPanelProps = {
  token: string;
  itemId: string;
  marketplaces: ExportMarketplace[];
  photos: { id: string; url: string | null }[];
  onListed: () => void;
};

// Pure validation for the "mark as listed" URL. Returns the exact seller-facing
// error, or null when the URL is safe to submit. The server route stays
// authoritative; this only prevents obvious mistakes before a round trip.
export function markAsListedError(
  marketplace: ExportMarketplace,
  url: string,
): string | null {
  if (!url.trim()) return "Paste the listing URL first.";
  if (!isPlausibleListingUrl(marketplace, url)) {
    return `That does not look like your ${marketplaceName(marketplace)} listing URL.`;
  }
  return null;
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

function GuidedListingSection({
  token,
  itemId,
  marketplace,
  photos,
  onListed,
}: {
  token: string;
  itemId: string;
  marketplace: ExportMarketplace;
  photos: { id: string; url: string | null }[];
  onListed: () => void;
}) {
  const meta = guidedListingMeta(marketplace);
  const name = marketplaceName(marketplace);
  const photoUrls = photos.filter((p): p is { id: string; url: string } =>
    Boolean(p.url),
  );

  const [exported, setExported] = useState<ExportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load(): Promise<ExportPayload | null> {
    if (exported) return exported;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.exportListing(token, itemId, marketplace);
      const payload: ExportPayload = {
        title: res.title,
        body: res.body,
        fields: res.fields,
        warnings: res.warnings,
      };
      setExported(payload);
      return payload;
    } catch (e) {
      setLoadError(
        (e as { error?: string })?.error ?? "Could not load the listing text.",
      );
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function copyFull() {
    const payload = await load();
    if (!payload) return;
    await copyText(`${payload.title}\n\n${payload.body}`);
    setCopiedKey("__full__");
  }

  async function copyField(key: string, value: string) {
    await copyText(value);
    setCopiedKey(key);
  }

  async function markListed() {
    const validation = markAsListedError(marketplace, url);
    if (validation) {
      setUrlError(validation);
      return;
    }
    setUrlError(null);
    setSaving(true);
    try {
      await api.addMarketplaceListing(token, {
        inventoryItemId: itemId,
        marketplace,
        externalUrl: url.trim(),
      });
      setSaved(true);
      onListed();
    } catch (e) {
      setUrlError(
        (e as { error?: string })?.error ?? "Could not save this listing.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="guided-mp stack-3" data-marketplace={marketplace}>
      <div className="row" style={{ gap: 12, alignItems: "center" }}>
        <MpLogo id={marketplace} size={28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mp-row__name">{name}</div>
        </div>
        {meta && (
          <a
            className="btn btn--secondary btn--sm"
            href={meta.sellFormUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {`Open ${name} sell form`}
          </a>
        )}
      </div>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Btn
          variant="secondary"
          size="sm"
          icon="copy"
          disabled={loading}
          onClick={() => void copyFull()}
        >
          {loading ? "Loading…" : "Copy full listing text"}
        </Btn>
        {copiedKey === "__full__" && (
          <span className="t-small muted">Copied. Paste it into {name}.</span>
        )}
      </div>

      {loadError && <div className="field__error">{loadError}</div>}

      {exported && (
        <div className="stack-2">
          {exported.fields.map((f) => (
            <div key={f.key} className="row" style={{ gap: 8, alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t-small muted">{f.label}</div>
                <div className="t-small guided-field__value">{f.value}</div>
              </div>
              <Btn
                variant="ghost"
                size="sm"
                icon="copy"
                onClick={() => void copyField(f.key, f.value)}
              >
                {copiedKey === f.key ? "Copied" : "Copy"}
              </Btn>
            </div>
          ))}
          {exported.warnings.length > 0 && (
            <Banner
              variant="warn"
              title="Some fields need your review"
              desc={exported.warnings.join(" · ")}
            />
          )}
        </div>
      )}

      {photoUrls.length > 0 && (
        <div className="stack-1">
          <div className="t-small muted">
            Photos (open each, then save or drag into the {name} form)
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {photoUrls.map((p, idx) => (
              <a
                key={p.id}
                className="btn btn--ghost btn--sm"
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {`Photo ${idx + 1}`}
              </a>
            ))}
          </div>
        </div>
      )}

      {saved ? (
        <Banner
          variant="info"
          title={`Tracking your ${name} listing`}
          desc="Sello will flag this listing if the item sells on another channel."
        />
      ) : (
        <div className="stack-1">
          <Field
            label="Mark as listed"
            hint={`Paste the ${name} listing URL after you post it, so Sello can keep it in sync.`}
            error={urlError ?? undefined}
          >
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                type="url"
                inputMode="url"
                placeholder={`https://…`}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (urlError) setUrlError(null);
                }}
                style={{ flex: 1, minWidth: 0 }}
              />
              <Btn
                variant="primary"
                size="sm"
                disabled={saving}
                onClick={() => void markListed()}
              >
                {saving ? "Saving…" : "Mark as listed"}
              </Btn>
            </div>
          </Field>
        </div>
      )}
    </section>
  );
}

export function GuidedListingPanel({
  token,
  itemId,
  marketplaces,
  photos,
  onListed,
}: GuidedListingPanelProps) {
  if (marketplaces.length === 0) return null;

  return (
    <section className="card">
      <div className="card__head">
        <span className="card__title">Guided publish</span>
      </div>
      <div className="card__body stack-4">
        <div className="t-small muted">
          For channels Sello does not publish to directly: open the sell form,
          copy each field, add the photos, then paste the live URL back so the
          double-sell safety net covers it. Nothing is published automatically.
        </div>
        {marketplaces.map((mp) => (
          <GuidedListingSection
            key={mp}
            token={token}
            itemId={itemId}
            marketplace={mp}
            photos={photos}
            onListed={onListed}
          />
        ))}
      </div>
    </section>
  );
}
