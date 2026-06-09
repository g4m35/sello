"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";
import { Badge, Banner, Btn, Check, Ring } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { MpLogo, Thumb } from "@/components/ui/marketplace";
import { FormSection, Field } from "@/components/ui/form";
import { Topbar } from "@/components/app/topbar";
import { ErrorState, PageSkeleton } from "@/components/app/states";
import { PublishModal } from "@/components/app/publish-modal";
import { AutoPricing } from "@/components/app/auto-pricing";
import {
  formatMoneyCents,
  estPayoutCents,
  conditionLabel,
  categoryLabel,
  relativeTime,
  splitTitle,
  durationLabel,
} from "@/lib/view/format";
import { DESIGN_STATUS_LABEL } from "@/lib/view/status";
import { marketplaceName } from "@/lib/view/marketplaces";
import {
  ExportMarketplaceSchema,
  type ExportMarketplace,
} from "@/lib/marketplace/export-formatters";
import type { ItemDetailView } from "@/lib/view/types";

type SaveState = "idle" | "saving" | "saved" | "error";

type DraftEdits = {
  title: string;
  description: string;
  bulletPoints: string[];
  recommendedPriceCents: number | null;
  selectedMarketplaces: string[];
};

type ItemEdits = {
  brand: string;
  category: string;
  condition: string;
  size: string;
  colorway: string;
};

const AUTOSAVE_MS = 800;

const CATEGORY_OPTIONS = [
  "sneakers",
  "streetwear",
  "hype_fashion",
  "accessories",
  "other",
] as const;
const CONDITION_OPTIONS = [
  "new_with_tags",
  "new_without_tags",
  "used_excellent",
  "used_good",
  "used_fair",
  "for_parts",
  "unknown",
] as const;

function editsFrom(item: ItemDetailView): DraftEdits {
  return {
    title: item.title,
    description: item.description,
    bulletPoints: item.bulletPoints,
    recommendedPriceCents: item.priceCents,
    selectedMarketplaces: item.selectedMarketplaces,
  };
}

function itemEditsFrom(item: ItemDetailView): ItemEdits {
  return {
    brand: item.brand ?? "",
    category: item.category,
    condition: item.condition,
    size: item.size ?? "",
    colorway: item.colorway ?? "",
  };
}

function centsToDollars(cents: number | null): string {
  if (cents == null) return "";
  return (cents / 100).toString();
}

function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const text =
    state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save failed";
  const color =
    state === "error" ? "var(--accent)" : state === "saved" ? "var(--ink-3)" : "var(--ink-3)";
  return (
    <span className="t-small" style={{ color, whiteSpace: "nowrap" }}>
      {text}
    </span>
  );
}

export default function ListingDetailPage() {
  const router = useRouter();
  const { token } = useSession();
  const { id } = useParams<{ id: string }>();

  const [item, setItem] = useState<ItemDetailView | null>(null);
  const [edits, setEdits] = useState<DraftEdits | null>(null);
  const [itemEdits, setItemEdits] = useState<ItemEdits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [publishOpen, setPublishOpen] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [removingPhotoId, setRemovingPhotoId] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<ExportMarketplace | null>(null);
  const [exportResult, setExportResult] = useState<{
    marketplace: ExportMarketplace;
    warnings: string[];
  } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const uploadPhotos = useCallback(
    async (files: File[]) => {
      setUploadingPhotos(true);
      setPhotoError(null);
      try {
        await api.addPhotos(token, id, files);
        reload();
      } catch (e) {
        setPhotoError((e as { error?: string })?.error ?? "Could not upload photos.");
      } finally {
        setUploadingPhotos(false);
      }
    },
    [token, id, reload],
  );

  const removePhoto = useCallback(
    async (photoId: string) => {
      setRemovingPhotoId(photoId);
      setPhotoError(null);
      try {
        await api.deletePhoto(token, id, photoId);
        reload();
      } catch (e) {
        setPhotoError((e as { error?: string })?.error ?? "Could not remove photo.");
      } finally {
        setRemovingPhotoId(null);
      }
    },
    [token, id, reload],
  );

  const setCoverPhoto = useCallback(
    async (photoId: string) => {
      setRemovingPhotoId(photoId);
      setPhotoError(null);
      try {
        await api.setCoverPhoto(token, id, photoId);
        reload();
      } catch (e) {
        setPhotoError((e as { error?: string })?.error ?? "Could not set cover.");
      } finally {
        setRemovingPhotoId(null);
      }
    },
    [token, id, reload],
  );

  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const res = await api.getItem(token, id);
        if (!active) return;
        setItem(res.item);
        setEdits(editsFrom(res.item));
        setItemEdits(itemEditsFrom(res.item));
        setError(null);
      } catch (e) {
        if (active) {
          setError((e as { error?: string })?.error ?? "Could not load this listing.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [token, id, reloadKey]);

  const draftId = item?.draftId ?? null;

  const save = useCallback(
    async (next: DraftEdits) => {
      if (!draftId) return;
      setSaveState("saving");
      try {
        await api.updateDraft(token, draftId, {
          title: next.title,
          description: next.description,
          bulletPoints: next.bulletPoints,
          recommendedPriceCents: next.recommendedPriceCents,
          selectedMarketplaces: next.selectedMarketplaces,
        });
        setSaveState("saved");
        dirtyRef.current = false;
      } catch {
        setSaveState("error");
      }
    },
    [token, draftId],
  );

  const queueSave = useCallback(
    (next: DraftEdits) => {
      if (!draftId) return;
      dirtyRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void save(next);
      }, AUTOSAVE_MS);
    },
    [draftId, save],
  );

  const patch = useCallback(
    (changes: Partial<DraftEdits>) => {
      setEdits((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...changes };
        queueSave(next);
        return next;
      });
    },
    [queueSave],
  );

  const forceSave = useCallback(() => {
    if (!edits || !draftId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void save(edits);
  }, [edits, draftId, save]);

  const saveItem = useCallback(
    async (next: ItemEdits) => {
      setSaveState("saving");
      try {
        await api.updateItem(token, id, {
          brand: next.brand.trim() || null,
          category: next.category,
          condition: next.condition,
          size: next.size.trim() || null,
          colorway: next.colorway.trim() || null,
        });
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    },
    [token, id],
  );

  const patchItem = useCallback(
    (changes: Partial<ItemEdits>) => {
      setItemEdits((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...changes };
        if (itemDebounceRef.current) clearTimeout(itemDebounceRef.current);
        itemDebounceRef.current = setTimeout(() => void saveItem(next), AUTOSAVE_MS);
        return next;
      });
    },
    [saveItem],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (itemDebounceRef.current) clearTimeout(itemDebounceRef.current);
    };
  }, []);

  const duplicate = useCallback(async () => {
    if (!draftId) return;
    try {
      const res = await api.draftAction(token, draftId, "duplicate");
      router.push(`/inventory/${res.inventoryItem.id}`);
    } catch (e) {
      setError((e as { error?: string })?.error ?? "Could not duplicate this draft.");
    }
  }, [token, draftId, router]);

  // Approve the draft (move it to the ready lifecycle state) before opening the
  // publish modal, so publishing is not rejected with a 409 "not ready" error.
  const requestPublish = useCallback(async () => {
    if (
      !draftId ||
      !edits ||
      item?.lifecycleState === "ready" ||
      item?.lifecycleState === "active"
    ) {
      setPublishOpen(true);
      return;
    }
    setApproving(true);
    try {
      await api.updateDraft(token, draftId, {
        title: edits.title,
        description: edits.description,
        bulletPoints: edits.bulletPoints,
        recommendedPriceCents: edits.recommendedPriceCents,
        selectedMarketplaces: edits.selectedMarketplaces,
        approve: true,
      });
      reload();
      setPublishOpen(true);
    } catch (e) {
      setSaveState("error");
      setPhotoError((e as { error?: string })?.error ?? "Could not mark the item ready to publish.");
    } finally {
      setApproving(false);
    }
  }, [token, draftId, edits, item, reload]);

  const copyExport = useCallback(
    async (marketplace: ExportMarketplace) => {
      setExportBusy(marketplace);
      setExportError(null);
      setExportResult(null);
      try {
        const res = await api.exportListing(token, id, marketplace);
        await navigator.clipboard.writeText(`${res.title}\n\n${res.body}`);
        setExportResult({ marketplace, warnings: res.warnings });
      } catch (e) {
        setExportError(
          (e as { error?: string })?.error ?? "Could not copy the listing text.",
        );
      } finally {
        setExportBusy(null);
      }
    },
    [token, id],
  );

  const runLifecycle = useCallback(
    async (action: "mark_sold" | "delist") => {
      const label = action === "mark_sold" ? "mark this item as sold" : "delist this item";
      if (!window.confirm(`Are you sure you want to ${label}?`)) return;
      setMenuOpen(false);
      setLifecycleBusy(true);
      setNotice(null);
      try {
        await api.lifecycle(token, { inventoryItemId: id, action });
        reload();
      } catch (e) {
        setNotice((e as { error?: string })?.error ?? "Could not update the item.");
      } finally {
        setLifecycleBusy(false);
      }
    },
    [token, id, reload],
  );

  if (loading)
    return (
      <>
        <Topbar crumbs={["Inventory"]} />
        <PageSkeleton />
      </>
    );
  if (error && !item)
    return (
      <>
        <Topbar crumbs={["Inventory"]} />
        <main className="page">
          <ErrorState message={error} onRetry={reload} />
        </main>
      </>
    );
  if (!item || !edits || !itemEdits)
    return (
      <>
        <Topbar crumbs={["Inventory"]} />
        <main className="page">
          <ErrorState message="Listing not found." />
        </main>
      </>
    );

  const editable = draftId != null;
  const shortId = item.id.slice(0, 8);
  const canMarkSold = item.lifecycleState === "ready" || item.lifecycleState === "active";
  const canDelist =
    item.lifecycleState === "draft" ||
    item.lifecycleState === "ready" ||
    item.lifecycleState === "active";
  const hasLifecycleActions = canMarkSold || canDelist;
  const { head, tail } = splitTitle(item.title);
  const metaParts = [
    item.brand,
    categoryLabel(item.category),
    conditionLabel(item.condition),
    `edited ${relativeTime(item.updatedAt)}`,
  ].filter(Boolean);

  const togglePhotoWarn = item.photos.length < 3;

  const toggleMarketplace = (mp: string) => {
    const current = edits.selectedMarketplaces;
    const next = current.includes(mp)
      ? current.filter((m) => m !== mp)
      : [...current, mp];
    patch({ selectedMarketplaces: next });
  };

  return (
    <>
      <Topbar
        crumbs={["Inventory", item.title]}
        right={
          <>
            <SaveIndicator state={saveState} />
            <Btn
              variant="ghost"
              size="sm"
              icon="external"
              disabled
              title="View live (not published)"
            >
              View live
            </Btn>
            <Btn
              variant="secondary"
              size="sm"
              icon="copy"
              disabled={!editable}
              onClick={() => void duplicate()}
            >
              Duplicate
            </Btn>
            {hasLifecycleActions && (
              <div style={{ position: "relative" }}>
                <Btn
                  variant="ghost"
                  size="sm"
                  icon="more"
                  title="More actions"
                  disabled={lifecycleBusy}
                  onClick={() => setMenuOpen((o) => !o)}
                />
                {menuOpen && (
                  <>
                    <div
                      style={{ position: "fixed", inset: 0, zIndex: 30 }}
                      onClick={() => setMenuOpen(false)}
                    />
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: "calc(100% + 4px)",
                        zIndex: 31,
                        background: "var(--surface)",
                        border: "1px solid var(--line)",
                        borderRadius: "var(--r-3)",
                        boxShadow: "var(--shadow-3)",
                        padding: 4,
                        minWidth: 160,
                      }}
                    >
                      {canMarkSold && (
                        <button
                          type="button"
                          className="nav-item"
                          onClick={() => void runLifecycle("mark_sold")}
                        >
                          <Icon name="tag" size={14} /> Mark sold
                        </button>
                      )}
                      {canDelist && (
                        <button
                          type="button"
                          className="nav-item"
                          onClick={() => void runLifecycle("delist")}
                        >
                          <Icon name="x-c" size={14} /> Delist
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        }
      />

      <main className="page">
        {notice && (
          <div style={{ marginBottom: "var(--s-4)" }}>
            <Banner variant="warn" title={notice} />
          </div>
        )}
        <div className="page__head">
          <div className="page__title-row">
            <div className="row" style={{ gap: 10 }}>
              <Badge status={item.status} label={item.statusLabel} />
              <span className="t-mono muted t-small">
                {shortId} · {item.sku ?? "no SKU"}
              </span>
            </div>
            <h1 className="page__title" style={{ marginTop: 4 }}>
              {head}
              {tail && (
                <>
                  {" "}
                  <em>{tail}</em>
                </>
              )}
            </h1>
            <div className="page__title-meta">{metaParts.join(" · ")}</div>
          </div>
          <div className="page__actions">
            <Btn variant="ghost" size="sm" icon="x" onClick={() => router.back()}>
              Discard
            </Btn>
            <Btn
              variant="secondary"
              size="sm"
              icon="check"
              disabled={!editable}
              onClick={forceSave}
            >
              Save draft
            </Btn>
            <Btn
              variant="accent"
              size="sm"
              icon="send"
              kbd="⌘↵"
              disabled={!item.readiness.ready || approving}
              onClick={requestPublish}
            >
              Publish
            </Btn>
          </div>
        </div>

        {!editable && (
          <Banner
            variant="warn"
            title="Editing unavailable"
            desc="This item was created without a draft, so its fields cannot be edited here. The details below are read-only."
          />
        )}

        <div className="detail">
          <div className="card">
            <FormSection
              title="Photos"
              desc={`${item.photos.length} photos`}
            >
              <div className="images">
                {item.photos.map((photo, idx) => (
                  <div
                    key={photo.id}
                    className={`image-tile ${idx === 0 ? "image-tile--primary" : ""}`}
                  >
                    {idx === 0 && <span className="image-tile__badge">Cover</span>}
                    {photo.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo.url} alt={`Photo ${idx + 1}`} />
                    ) : (
                      <Thumb seed={photo.id} size={120} />
                    )}
                    {editable && (
                      <button
                        type="button"
                        className="image-tile__remove"
                        title="Remove photo"
                        onClick={() => void removePhoto(photo.id)}
                        disabled={removingPhotoId === photo.id}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    )}
                    {editable && idx !== 0 && (
                      <button
                        type="button"
                        className="image-tile__cover"
                        title="Set as cover"
                        onClick={() => void setCoverPhoto(photo.id)}
                        disabled={removingPhotoId === photo.id}
                      >
                        <Icon name="arrow-up" size={12} /> Cover
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="image-tile image-tile--add"
                  title="Add photos"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploadingPhotos}
                >
                  <Icon name={uploadingPhotos ? "clock" : "plus"} size={20} />
                  {uploadingPhotos ? "Uploading…" : "Add"}
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = e.target.files ? Array.from(e.target.files) : [];
                    if (files.length) void uploadPhotos(files);
                    e.target.value = "";
                  }}
                />
              </div>
              {photoError && (
                <div className="field__error" style={{ marginTop: 8 }}>
                  {photoError}
                </div>
              )}
              {togglePhotoWarn && (
                <div style={{ marginTop: 12 }}>
                  <Banner
                    variant="warn"
                    title="Add at least 3 photos for best results"
                    desc="More angles help buyers and improve listing quality."
                  />
                </div>
              )}
            </FormSection>

            <FormSection title="Basics">
              <Field label="Title" hint={`${edits.title.length}/80`}>
                <input
                  className="input"
                  value={edits.title}
                  maxLength={80}
                  disabled={!editable}
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </Field>

              <div className="form-grid form-grid--3">
                <Field label="Brand">
                  <input
                    className="input"
                    value={itemEdits.brand}
                    placeholder="Brand"
                    onChange={(e) => patchItem({ brand: e.target.value })}
                  />
                </Field>
                <Field label="Category">
                  <select
                    className="select"
                    value={itemEdits.category}
                    onChange={(e) => patchItem({ category: e.target.value })}
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {categoryLabel(c)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Condition">
                  <select
                    className="select"
                    value={itemEdits.condition}
                    onChange={(e) => patchItem({ condition: e.target.value })}
                  >
                    {CONDITION_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {conditionLabel(c)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Size">
                  <input
                    className="input"
                    value={itemEdits.size}
                    placeholder="Size"
                    onChange={(e) => patchItem({ size: e.target.value })}
                  />
                </Field>
                <Field label="Color">
                  <input
                    className="input"
                    value={itemEdits.colorway}
                    placeholder="Color"
                    onChange={(e) => patchItem({ colorway: e.target.value })}
                  />
                </Field>
              </div>

              <Field label="Description" hint={`${edits.description.length} chars`}>
                <textarea
                  className="textarea"
                  value={edits.description}
                  rows={6}
                  disabled={!editable}
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </Field>

              <Field label="Highlights">
                <div className="stack-4">
                  {edits.bulletPoints.map((bullet, idx) => (
                    <div key={idx} className="row" style={{ gap: 8 }}>
                      <input
                        className="input"
                        value={bullet}
                        disabled={!editable}
                        placeholder="Highlight"
                        onChange={(e) => {
                          const next = [...edits.bulletPoints];
                          next[idx] = e.target.value;
                          patch({ bulletPoints: next });
                        }}
                      />
                      <Btn
                        variant="ghost"
                        size="sm"
                        icon="trash"
                        title="Remove"
                        disabled={!editable}
                        onClick={() =>
                          patch({
                            bulletPoints: edits.bulletPoints.filter((_, i) => i !== idx),
                          })
                        }
                      />
                    </div>
                  ))}
                  <div>
                    <Btn
                      variant="secondary"
                      size="sm"
                      icon="plus"
                      disabled={!editable}
                      onClick={() =>
                        patch({ bulletPoints: [...edits.bulletPoints, ""] })
                      }
                    >
                      Add bullet
                    </Btn>
                  </div>
                </div>
              </Field>
            </FormSection>

            <FormSection
              title="Pricing"
              desc={
                edits.recommendedPriceCents != null
                  ? `Est payout ${formatMoneyCents(estPayoutCents(edits.recommendedPriceCents))}`
                  : "Set a price to see estimated payout"
              }
            >
              <div className="form-grid form-grid--3">
                <Field
                  label="Sell price"
                  hint={
                    edits.recommendedPriceCents != null
                      ? `payout ${formatMoneyCents(estPayoutCents(edits.recommendedPriceCents))}`
                      : undefined
                  }
                >
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={centsToDollars(edits.recommendedPriceCents)}
                    disabled={!editable}
                    onChange={(e) =>
                      patch({ recommendedPriceCents: dollarsToCents(e.target.value) })
                    }
                  />
                </Field>
              </div>
              <div className="divider" />
              <AutoPricing itemId={id} />
            </FormSection>
          </div>

          <div className="readiness">
            <section className="card">
              <div className="readiness__head">
                <div className="readiness__ring">
                  <Ring pct={item.readiness.pct} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="card__title">
                    {item.readiness.ready ? "Ready to publish" : "Keep going"}
                  </div>
                  <div className="t-small muted">
                    {item.readiness.doneCount} of {item.readiness.totalCount} checks
                  </div>
                </div>
                <Btn
                  variant="accent"
                  size="sm"
                  icon="send"
                  disabled={!item.readiness.ready || approving}
                  onClick={requestPublish}
                >
                  {approving ? "Preparing…" : "Publish"}
                </Btn>
              </div>
              <ul className="readiness__list">
                {item.readiness.checks.map((check) => (
                  <li key={check.id} className={`readiness__item readiness__item--${check.state}`}>
                    <span className="readiness__item-icon">
                      <Icon
                        name={
                          check.state === "done"
                            ? "check"
                            : check.state === "warn"
                              ? "warn"
                              : "x"
                        }
                        size={14}
                      />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="readiness__item-title">{check.title}</div>
                      <div className="readiness__item-sub">{check.sub}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card">
              <div className="card__head">
                <span className="card__title">Marketplaces</span>
                <span className="t-small muted">{item.channels.length} configured</span>
              </div>
              <div className="card__body stack-4">
                {item.channels.map((channel) => {
                  const meta =
                    channel.status === "published" && channel.externalListingId
                      ? `ID ${channel.externalListingId}`
                      : channel.publishImplemented
                        ? "Ready"
                        : "Draft preview only";
                  const selected = edits.selectedMarketplaces.includes(channel.marketplace);
                  return (
                    <div
                      key={channel.marketplace}
                      className="row"
                      style={{ gap: 12 }}
                    >
                      <Check
                        checked={selected}
                        disabled={!editable}
                        onChange={() => toggleMarketplace(channel.marketplace)}
                      />
                      <MpLogo id={channel.marketplace} size={28} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="mp-row__name">{channel.name}</div>
                        <div className="mp-row__meta">{meta}</div>
                      </div>
                      <Badge status={channel.status} />
                    </div>
                  );
                })}
                {item.channels.length === 0 && (
                  <div className="t-small muted">No channels configured.</div>
                )}
              </div>
            </section>

            <section className="card">
              <div className="card__head">
                <span className="card__title">Copy listing text</span>
              </div>
              <div className="card__body stack-4">
                <div className="t-small muted">
                  Copies paste-ready listing text to your clipboard for manual
                  posting. Nothing is published automatically.
                </div>
                {ExportMarketplaceSchema.options.map((mp) => (
                  <div key={mp} className="row" style={{ gap: 12 }}>
                    <MpLogo id={mp} size={28} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mp-row__name">{marketplaceName(mp)}</div>
                    </div>
                    <Btn
                      variant="secondary"
                      size="sm"
                      icon="copy"
                      disabled={exportBusy != null}
                      onClick={() => void copyExport(mp)}
                    >
                      {exportBusy === mp ? "Copying…" : `Copy for ${marketplaceName(mp)}`}
                    </Btn>
                  </div>
                ))}
                {exportError && <div className="field__error">{exportError}</div>}
                {exportResult && exportResult.warnings.length === 0 && (
                  <Banner
                    variant="info"
                    title={`Copied ${marketplaceName(exportResult.marketplace)} listing text`}
                    desc={`Paste it into the ${marketplaceName(exportResult.marketplace)} listing form.`}
                  />
                )}
                {exportResult && exportResult.warnings.length > 0 && (
                  <Banner
                    variant="warn"
                    title={`Copied ${marketplaceName(exportResult.marketplace)} listing text with gaps`}
                    desc={exportResult.warnings.join(" · ")}
                  />
                )}
              </div>
            </section>

            <section className="card">
              <div className="card__head">
                <span className="card__title">Recent activity</span>
              </div>
              <div className="card__body">
                {item.attempts.length === 0 ? (
                  <div className="t-small muted">No publish attempts yet.</div>
                ) : (
                  <div className="stack-4">
                    {item.attempts.slice(0, 5).map((attempt) => (
                      <div key={attempt.id} className="mp-row">
                        <MpLogo id={attempt.marketplace} size={28} />
                        <div className="mp-row__name">
                          {DESIGN_STATUS_LABEL[attempt.status]}
                        </div>
                        <div className="mp-row__meta">
                          {relativeTime(attempt.time)} · {durationLabel(attempt.durationMs)}
                        </div>
                        <div className="mp-row__action">
                          <Badge status={attempt.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>

      <PublishModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        item={item}
        onPublished={reload}
      />
    </>
  );
}
