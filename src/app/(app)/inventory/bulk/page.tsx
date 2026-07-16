"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { Topbar } from "@/components/app/topbar";
import { useSession } from "@/components/providers/session-provider";
import { Banner, Btn } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import type { BulkBatchSummaryView, BulkBatchView } from "@/lib/bulk-intake/types";

const ABSOLUTE_MAX_ITEMS = 250;
const PHOTOS_PER_ITEM = 3;

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function defaultGroups(photoIds: string[]) {
  const groups: string[][] = [];
  for (let index = 0; index < photoIds.length; index += PHOTOS_PER_ITEM) {
    groups.push(photoIds.slice(index, index + PHOTOS_PER_ITEM));
  }
  return groups;
}

function groupsFromBatch(batch: BulkBatchView) {
  if (batch.items.length === 0) return defaultGroups(batch.photos.map((photo) => photo.id));
  return batch.items.map((item) => item.photos.map((photo) => photo.id));
}

export default function BulkIntakePage() {
  const router = useRouter();
  const { token } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchCreationKeyRef = useRef(globalThis.crypto.randomUUID());
  const [batch, setBatch] = useState<BulkBatchView | null>(null);
  const [recent, setRecent] = useState<BulkBatchSummaryView[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [groups, setGroups] = useState<string[][]>([]);
  const [maxItems, setMaxItems] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxPhotos = Math.min(maxItems, ABSOLUTE_MAX_ITEMS) * PHOTOS_PER_ITEM;
  const progress = batch?.totalItems
    ? Math.round((batch.processedItems / batch.totalItems) * 100)
    : 0;

  useEffect(() => {
    let active = true;
    Promise.all([api.listBulkBatches(token), api.getFeatureAccess(token)])
      .then(([batchResult, access]) => {
        if (!active) return;
        setRecent(batchResult.batches);
        setMaxItems(Math.min(access.limits.bulkBatchSize, ABSOLUTE_MAX_ITEMS));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [token]);

  const assignments = useMemo(() => {
    const result = new Map<string, number>();
    groups.forEach((group, groupIndex) => {
      group.forEach((photoId) => result.set(photoId, groupIndex));
    });
    return result;
  }, [groups]);

  const loadBatch = useCallback(
    async (batchId: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await api.getBulkBatch(token, batchId);
        setBatch(result.batch);
        setGroups(groupsFromBatch(result.batch));
        setFiles([]);
      } catch (reason) {
        setError((reason as { error?: string }).error ?? "Could not load this batch.");
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  const uploadAndGroup = useCallback(async () => {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const expectedItems = Math.ceil(files.length / PHOTOS_PER_ITEM);
      const created = await api.createBulkBatch(
        token,
        expectedItems,
        batchCreationKeyRef.current,
      );
      const uploaded = await api.uploadBulkPhotos(token, created.batch.id, files);
      const initialGroups = defaultGroups(uploaded.batch.photos.map((photo) => photo.id));
      const grouped = await api.groupBulkPhotos(
        token,
        uploaded.batch.id,
        initialGroups.map((photoIds) => ({ photoIds })),
      );
      setBatch(grouped.batch);
      setGroups(groupsFromBatch(grouped.batch));
      setFiles([]);
      batchCreationKeyRef.current = globalThis.crypto.randomUUID();
      setRecent((current) => [
        {
          id: grouped.batch.id,
          status: grouped.batch.status,
          photoCount: grouped.batch.photoCount,
          totalItems: grouped.batch.totalItems,
          processedItems: grouped.batch.processedItems,
          needsReviewItems: grouped.batch.needsReviewItems,
          listingReadyItems: grouped.batch.listingReadyItems,
          failedItems: grouped.batch.failedItems,
          canceledItems: grouped.batch.canceledItems,
          createdAt: grouped.batch.createdAt,
          updatedAt: grouped.batch.updatedAt,
        },
        ...current.filter((entry) => entry.id !== grouped.batch.id),
      ]);
    } catch (reason) {
      setError((reason as { error?: string }).error ?? "Could not create this bulk batch.");
    } finally {
      setBusy(false);
    }
  }, [busy, files, token]);

  const movePhoto = useCallback((photoId: string, nextGroup: number) => {
    setGroups((current) => {
      const next = current.map((group) => group.filter((id) => id !== photoId));
      while (next.length <= nextGroup) next.push([]);
      if (next[nextGroup]!.length >= PHOTOS_PER_ITEM) return current;
      next[nextGroup] = [...next[nextGroup]!, photoId];
      return next;
    });
  }, []);

  const saveGrouping = useCallback(async () => {
    if (!batch || busy) return;
    const nonEmptyGroups = groups.filter((group) => group.length > 0);
    setBusy(true);
    setError(null);
    try {
      const result = await api.groupBulkPhotos(
        token,
        batch.id,
        nonEmptyGroups.map((photoIds) => ({ photoIds })),
      );
      setBatch(result.batch);
      setGroups(groupsFromBatch(result.batch));
    } catch (reason) {
      setError((reason as { error?: string }).error ?? "Could not save photo groups.");
    } finally {
      setBusy(false);
    }
  }, [batch, busy, groups, token]);

  const refreshBatch = useCallback(async () => {
    if (!batch) return null;
    const result = await api.getBulkBatch(token, batch.id);
    setBatch(result.batch);
    return result.batch;
  }, [batch, token]);

  const generateAll = useCallback(async () => {
    if (!batch || busy) return;
    setBusy(true);
    setError(null);
    try {
      const start = await api.startBulkGeneration(token, batch.id);
      setBatch(start.batch);
      for (const itemId of start.itemIds) {
        await api.generateBulkItem(token, batch.id, itemId).catch(() => undefined);
        const current = await api.getBulkBatch(token, batch.id);
        setBatch(current.batch);
      }
    } catch (reason) {
      setError((reason as { error?: string }).error ?? "Could not continue generation.");
    } finally {
      setBusy(false);
    }
  }, [batch, busy, token]);

  const retryItem = useCallback(
    async (itemId: string) => {
      if (!batch || busy) return;
      setBusy(true);
      setError(null);
      try {
        await api.convertBulkItem(token, batch.id, itemId);
        await refreshBatch();
      } catch (reason) {
        setError((reason as { error?: string }).error ?? "Could not retry this item.");
      } finally {
        setBusy(false);
      }
    },
    [batch, busy, refreshBatch, token],
  );

  const cancel = useCallback(async () => {
    if (!batch || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.cancelBulkBatch(token, batch.id);
      setBatch(result.batch);
    } catch (reason) {
      setError((reason as { error?: string }).error ?? "Could not cancel this batch.");
    } finally {
      setBusy(false);
    }
  }, [batch, busy, token]);

  return (
    <>
      <Topbar
        crumbs={["Inventory", "Bulk intake"]}
        right={
          batch ? (
            <Btn
              variant="ghost"
              onClick={() => {
                setBatch(null);
                setGroups([]);
                setError(null);
              }}
              disabled={busy}
            >
              New batch
            </Btn>
          ) : null
        }
      />

      <main className="page stack-3">
        <div className="page__head">
          <h1 className="page__title">
            Bulk photo <em>intake</em>
          </h1>
          <div className="page__title-meta">
            Group photos, generate each listing independently, and review before publishing.
          </div>
        </div>

        {error ? <Banner variant="error" title="Bulk intake needs attention" desc={error} /> : null}

        {!batch ? (
          <section className="bulk-intake__layout">
            <div className="card bulk-upload">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                multiple
                hidden
                onChange={(event) => {
                  const selected = Array.from(event.target.files ?? []).slice(0, maxPhotos);
                  batchCreationKeyRef.current = globalThis.crypto.randomUUID();
                  setFiles(selected);
                  setError(null);
                  event.target.value = "";
                }}
              />
              <div>
                <div className="t-h3">Upload a batch</div>
                <p className="t-small muted">
                  Up to {maxItems} items on your plan, with 1–3 photos per item. You can regroup before generation.
                </p>
              </div>
              <button
                type="button"
                className="dropzone bulk-upload__dropzone"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                <strong>{files.length ? `${files.length} photos selected` : "Choose item photos"}</strong>
                <span className="t-small muted">JPEG, PNG, WEBP, or HEIC · 8MB each</span>
              </button>
              <div className="row">
                <Btn variant="accent" onClick={uploadAndGroup} disabled={busy || files.length === 0}>
                  {busy ? "Uploading…" : "Upload and review groups"}
                </Btn>
                {files.length > 0 ? (
                  <span className="t-small muted t-num">
                    Suggested items: {Math.ceil(files.length / PHOTOS_PER_ITEM)}
                  </span>
                ) : null}
              </div>
            </div>

            <aside className="card bulk-recent">
              <div className="t-h3">Resume a batch</div>
              {recent.length === 0 ? (
                <p className="t-small muted">No durable bulk batches yet.</p>
              ) : (
                recent.slice(0, 8).map((entry) => (
                  <button
                    type="button"
                    className="bulk-recent__row"
                    key={entry.id}
                    onClick={() => loadBatch(entry.id)}
                    disabled={busy}
                  >
                    <span>
                      <strong>Batch {entry.id.slice(0, 8)}</strong>
                      <span className="t-micro muted">{entry.totalItems} items · {entry.photoCount} photos</span>
                    </span>
                    <span className="badge">{statusLabel(entry.status)}</span>
                  </button>
                ))
              )}
            </aside>
          </section>
        ) : (
          <>
            <section className="card bulk-progress-card">
              <div className="row bulk-progress-card__head">
                <div>
                  <div className="t-micro">Batch {batch.id.slice(0, 8)}</div>
                  <div className="t-h3">{statusLabel(batch.status)}</div>
                </div>
                <span className="t-num bulk-progress-card__value">{progress}%</span>
              </div>
              <div className="bulk-progress" aria-label={`${progress}% processed`}>
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className="bulk-stats t-small muted t-num">
                <span>{batch.processedItems}/{batch.totalItems} processed</span>
                <span>{batch.listingReadyItems} ready</span>
                <span>{batch.needsReviewItems} review</span>
                <span>{batch.failedItems} failed</span>
              </div>
            </section>

            {batch.items.every((item) => ["uploaded", "grouping", "ready_for_generation"].includes(item.status)) ? (
              <section className="card stack-2">
                <div className="row bulk-section-head">
                  <div>
                    <div className="t-h3">Review photo groups</div>
                    <p className="t-small muted">Assign each photo to one item. Each item can use up to 3 photos.</p>
                  </div>
                  <Btn
                    variant="secondary"
                    onClick={() => setGroups((current) => [...current, []])}
                    disabled={busy || groups.length >= maxItems}
                  >
                    Add item group
                  </Btn>
                </div>
                <div className="bulk-photo-grid">
                  {batch.photos.map((photo) => (
                    <article className="bulk-photo" key={photo.id}>
                      {photo.url ? (
                        <Image
                          src={photo.url}
                          alt={photo.originalName}
                          width={320}
                          height={240}
                          unoptimized
                        />
                      ) : <div className="bulk-photo__empty" />}
                      <div className="bulk-photo__body">
                        <span title={photo.originalName}>{photo.originalName}</span>
                        <select
                          value={assignments.get(photo.id) ?? 0}
                          onChange={(event) => movePhoto(photo.id, Number(event.target.value))}
                          disabled={busy}
                          aria-label={`Item group for ${photo.originalName}`}
                        >
                          {groups.map((_, index) => (
                            <option key={index} value={index}>Item {index + 1}</option>
                          ))}
                        </select>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="row">
                  <Btn variant="secondary" onClick={saveGrouping} disabled={busy}>Save groups</Btn>
                  <Btn variant="accent" onClick={generateAll} disabled={busy || groups.some((group) => group.length === 0)}>
                    {busy ? "Working…" : "Generate listings"}
                  </Btn>
                  <Btn variant="ghost" onClick={cancel} disabled={busy}>Cancel batch</Btn>
                </div>
              </section>
            ) : (
              <div className="row bulk-section-head">
                <div>
                  <div className="t-h3">Listings</div>
                  <p className="t-small muted">Every item is isolated; one failure does not block the rest.</p>
                </div>
                <div className="row">
                  {batch.items.some((item) => ["ready_for_generation", "failed"].includes(item.status) || (item.status === "needs_review" && !item.inventoryItemId)) ? (
                    <Btn variant="accent" onClick={generateAll} disabled={busy}>
                      {busy ? "Continuing…" : "Continue generation"}
                    </Btn>
                  ) : null}
                  {batch.status !== "canceled" ? <Btn variant="ghost" onClick={cancel} disabled={busy}>Cancel</Btn> : null}
                </div>
              </div>
            )}

            <section className="bulk-item-grid">
              {batch.items.map((item) => (
                <article className="card bulk-item-card" key={item.id}>
                  <div className="row bulk-item-card__head">
                    <strong>Item {item.position + 1}</strong>
                    <span className={`badge bulk-status bulk-status--${item.status}`}>{statusLabel(item.status)}</span>
                  </div>
                  <div className="bulk-item-card__photos">
                    {item.photos.map((photo) =>
                      photo.url ? (
                        <Image
                          key={photo.id}
                          src={photo.url}
                          alt={photo.originalName}
                          width={72}
                          height={72}
                          unoptimized
                        />
                      ) : null,
                    )}
                  </div>
                  {item.reviewReason ? <p className="t-small bulk-item-card__reason">{item.reviewReason}</p> : null}
                  {item.errorMessage ? <p className="t-small danger">{item.errorMessage}</p> : null}
                  <div className="row bulk-item-card__actions">
                    {item.inventoryItemId ? (
                      <Btn variant="secondary" onClick={() => router.push(`/inventory/${item.inventoryItemId}`)}>
                        Review listing
                      </Btn>
                    ) : null}
                    {(item.status === "failed" || item.status === "needs_review") && !item.inventoryItemId ? (
                      <Btn variant="secondary" onClick={() => retryItem(item.id)} disabled={busy}>
                        Retry item
                      </Btn>
                    ) : null}
                  </div>
                </article>
              ))}
            </section>
          </>
        )}
      </main>
    </>
  );
}
