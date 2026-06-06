"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";
import { Banner, Btn } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { MpLogo } from "@/components/ui/marketplace";
import { FormSection } from "@/components/ui/form";
import { Topbar } from "@/components/app/topbar";
import { ImportModal } from "@/components/app/import-modal";
import type { ChannelView } from "@/lib/view/types";

const MAX_FILES = 8;

type Preview = { file: File; url: string };

export default function NewListingPage() {
  const router = useRouter();
  const { token } = useSession();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [channels, setChannels] = useState<ChannelView[]>([]);

  useEffect(() => {
    let active = true;
    api
      .getChannels(token)
      .then((res) => {
        if (active) setChannels(res);
      })
      .catch(() => {
        // The channel list is informational here, so a failure should not
        // block the upload flow. The right rail simply stays empty.
      });
    return () => {
      active = false;
    };
  }, [token]);

  // Revoke any outstanding object URLs when the component unmounts.
  useEffect(() => {
    return () => {
      for (const p of previews) URL.revokeObjectURL(p.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (incoming.length === 0) return;
    setError("");
    setPreviews((prev) => {
      const room = MAX_FILES - prev.length;
      const next = incoming
        .slice(0, Math.max(0, room))
        .map((file) => ({ file, url: URL.createObjectURL(file) }));
      return [...prev, ...next];
    });
  }, []);

  const removeAt = useCallback((index: number) => {
    setPreviews((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const openPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const identify = useCallback(async () => {
    if (previews.length === 0 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await api.createDraftFromPhotos(
        token,
        previews.map((p) => p.file),
      );
      router.push(`/inventory/${res.inventoryItem.id}`);
    } catch (e) {
      setError((e as { error?: string })?.error ?? "Could not create a draft");
      setSubmitting(false);
    }
  }, [previews, submitting, token, router]);

  return (
    <>
      <Topbar
        crumbs={["Inventory", "New listing"]}
        right={
          <Btn variant="ghost" onClick={() => router.push("/inventory")}>
            Discard
          </Btn>
        }
      />

      <main className="page">
        <div className="page__head">
          <h1 className="page__title">
            Create a <em>listing</em>
          </h1>
          <div className="page__title-meta">
            Upload photos and AI drafts the listing for every channel.
          </div>
        </div>

        <div className="quickstart">
          <div className="quickstart__lead">
            <Icon name="spark" size={16} />
            Fastest way to start
          </div>
          <div className="quickstart__actions">
            <button className="qs-btn" onClick={openPicker} disabled={submitting}>
              <Icon name="upload" size={16} />
              <span>
                <span className="qs-btn__title">Upload photos</span>
                <span className="qs-btn__sub">AI identifies + drafts</span>
              </span>
            </button>
            <button
              className="qs-btn"
              onClick={() => setImportOpen(true)}
              disabled={submitting}
            >
              <Icon name="csv" size={16} />
              <span>
                <span className="qs-btn__title">Import CSV</span>
                <span className="qs-btn__sub">Bulk add as drafts</span>
              </span>
            </button>
            <button className="qs-btn" disabled title="Coming soon">
              <Icon name="link" size={16} />
              <span>
                <span className="qs-btn__title">Paste a URL</span>
                <span className="qs-btn__sub">Coming soon</span>
              </span>
            </button>
          </div>
        </div>

        <div className="detail">
          <div className="card">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />

            <FormSection
              title="Photos"
              desc="Add 1 to 3 clear photos. The first becomes the cover."
            >
              {previews.length === 0 ? (
                <button className="dropzone" onClick={openPicker}>
                  <Icon name="image" size={26} />
                  <div style={{ fontWeight: 500 }}>
                    Drop 1 to 3 photos or click to choose
                  </div>
                  <div className="t-small">
                    JPG or PNG. The first photo becomes the cover.
                  </div>
                </button>
              ) : (
                <div className="images">
                  {previews.map((p, i) => (
                    <div
                      key={p.url}
                      className={`image-tile ${i === 0 ? "image-tile--primary" : ""}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={`Selected photo ${i + 1}`} />
                      {i === 0 && (
                        <span className="image-tile__badge">Cover</span>
                      )}
                      <button
                        type="button"
                        className="image-tile__remove"
                        title="Remove photo"
                        onClick={() => removeAt(i)}
                        disabled={submitting}
                      >
                        <Icon name="x" size={13} />
                      </button>
                    </div>
                  ))}
                  {previews.length < MAX_FILES && (
                    <button
                      type="button"
                      className="image-tile image-tile--add"
                      onClick={openPicker}
                      disabled={submitting}
                    >
                      <Icon name="plus" size={20} />
                      <span className="t-small">Add more</span>
                    </button>
                  )}
                </div>
              )}
            </FormSection>

            {error && (
              <div className="form-section">
                <Banner
                  variant="error"
                  title={error}
                  actions={
                    <Btn
                      variant="secondary"
                      size="sm"
                      icon="refresh"
                      onClick={() => void identify()}
                    >
                      Try again
                    </Btn>
                  }
                />
              </div>
            )}

            <div className="form-section">
              <Btn
                variant="accent"
                size="lg"
                icon="spark"
                disabled={previews.length === 0 || submitting}
                onClick={() => void identify()}
              >
                {submitting
                  ? "Identifying with AI… this can take a few seconds"
                  : "Identify & create draft"}
              </Btn>
              <div className="t-small muted" style={{ marginTop: 8 }}>
                {previews.length === 0
                  ? "Add at least one photo to continue."
                  : `${previews.length} photo${previews.length === 1 ? "" : "s"} selected · 1 to 3 recommended.`}
              </div>
            </div>

            <div className="form-section">
              <Banner
                variant="info"
                title="How it works"
                desc="We upload your photos, identify the product with AI, and generate an editable draft. Nothing is published."
              />
            </div>
          </div>

          <aside className="readiness">
            <div className="card">
              <FormSection
                title="Where it lists"
                desc="New drafts target every connected channel by default."
              >
                <div className="liston">
                  {channels.map((ch) => (
                    <div key={ch.marketplace} className="liston__row liston__row--on">
                      <MpLogo id={ch.marketplace} size={28} />
                      <div style={{ minWidth: 0 }}>
                        <div className="mp-row__name">{ch.name}</div>
                        <div className="mp-row__meta">
                          {ch.capabilities.publish
                            ? "Publishing enabled"
                            : "Draft preview only · CSV later"}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="liston__foot">
                    All new drafts target every connected channel. You can change
                    this per item after it&apos;s created.
                  </div>
                </div>
              </FormSection>
            </div>
          </aside>
        </div>
      </main>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => router.push("/inventory")}
      />
    </>
  );
}
