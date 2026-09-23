"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";
import { Banner, Btn } from "@/components/ui/primitives";
import { MpLogo } from "@/components/ui/marketplace";
import { FormSection } from "@/components/ui/form";
import { marketplaceCapabilityLabel } from "@/lib/view/marketplaces";
import type { ChannelView } from "@/lib/view/types";
import { Icon } from "@/components/ui/icon";
import { Topbar } from "@/components/app/topbar";
import { ListingAutomationSchema } from "@/lib/automation/policy";

const MAX_FILES = 3;
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
type Preview = { file: File; url: string };

export default function NewListingPage() {
  const router = useRouter();
  const { token } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const previewsRef = useRef<Preview[]>([]);
  const requestKey = useRef<string | null>(null);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [automaticPublish, setAutomaticPublish] = useState(false);
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [channels, setChannels] = useState<ChannelView[]>([]);

  useEffect(() => {
    let active = true;
    api.getChannels(token).then((result) => { if (active) setChannels(result); }).catch(() => {
      // Informational channel availability must not block creating a listing.
    });
    return () => { active = false; };
  }, [token]);

  useEffect(() => () => { for (const p of previewsRef.current) URL.revokeObjectURL(p.url); }, []);

  function addFiles(files: FileList | null) {
    if (!files || submitting) return;
    const selected = Array.from(files);
    if (selected.some((f) => !TYPES.has(f.type) || f.size > MAX_BYTES)) {
      setError("Choose JPEG, PNG, WEBP or HEIC photos, each 8MB or smaller."); return;
    }
    if (previewsRef.current.length + selected.length > MAX_FILES) { setError("Use up to 3 photos for identification. You can add more to the listing afterward."); return; }
    const next = [...previewsRef.current, ...selected.map((file) => ({ file, url: URL.createObjectURL(file) }))];
    previewsRef.current = next; setPreviews(next); setError(""); requestKey.current = null;
  }
  function remove(index: number) {
    URL.revokeObjectURL(previews[index].url);
    const next = previews.filter((_, i) => i !== index);
    previewsRef.current = next; setPreviews(next); requestKey.current = null;
  }
  async function prepare() {
    if (!previews.length || submitting) return;
    const policy = ListingAutomationSchema.safeParse(automaticPublish ? {
      mode: "publish", marketplace: "ebay", consent: true,
      minPriceCents: Math.round(Number(minimum) * 100), maxPriceCents: Math.round(Number(maximum) * 100),
    } : { mode: "prepare" });
    if (!policy.success) { setError("Enter a valid minimum and maximum listing price for automatic posting."); return; }
    setSubmitting(true); setError("");
    requestKey.current ??= crypto.randomUUID();
    try {
      const result = await api.createDraftFromPhotos(token, previews.map((p) => p.file), policy.data, requestKey.current);
      router.push(`/inventory/${result.inventoryItem.id}`);
    } catch (e) {
      if ((e as { retrySafe?: boolean })?.retrySafe === true) requestKey.current = null;
      setError((e as { error?: string })?.error ?? "Could not prepare the listing. Your selected photos are still here.");
      setSubmitting(false);
    }
  }
  return (
    <>
      <Topbar
        crumbs={["Inventory", "New listing"]}
        right={
          <Btn variant="ghost" disabled={submitting} onClick={() => router.push("/inventory")}>
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
            Upload photos and prepare a listing for your selected marketplaces.
          </div>
        </div>

        <div className="quickstart">
          <div className="quickstart__lead">
            <Icon name="spark" size={16} />
            Fastest way to start
          </div>
          <div className="quickstart__actions">
            <button className="qs-btn" onClick={() => input.current?.click()} disabled={submitting}>
              <Icon name="upload" size={16} />
              <span>
                <span className="qs-btn__title">Upload photos</span>
                <span className="qs-btn__sub">AI identifies + drafts</span>
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
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
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
                <button className="dropzone" disabled={submitting} onClick={() => input.current?.click()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
                  <Icon name="image" size={26} />
                  <div style={{ fontWeight: 500 }}>
                    Drop 1 to 3 photos or click to choose
                  </div>
                  <div className="t-small">
                    JPEG, PNG, WEBP or HEIC · 8MB each. The first photo becomes the cover.
                  </div>
                </button>
              ) : (
                <div className="images"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
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
                        aria-label={`Remove photo ${i + 1}`}
                        onClick={() => remove(i)}
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
                      onClick={() => input.current?.click()}
                      disabled={submitting}
                    >
                      <Icon name="plus" size={20} />
                      <span className="t-small">Add more</span>
                    </button>
                  )}
                </div>
              )}
            </FormSection>

        <div className="form-section"><label className="automation-choice"><input type="checkbox" checked={automaticPublish} disabled={submitting} onChange={(e) => { setAutomaticPublish(e.target.checked); requestKey.current = null; }} /><span><strong>Post to eBay automatically</strong><span className="t-small muted">Only with a confident match, reliable sold comparisons, and your authorized price range. Other marketplaces are selected during review.</span></span></label>
        {automaticPublish && <div className="stack-3">
          <div className="form-grid form-grid--2">
            <label className="field"><span>Minimum listing price (USD)</span><input className="input" type="number" min="0.01" step="0.01" value={minimum} disabled={submitting} onChange={(e) => { setMinimum(e.target.value); requestKey.current = null; }} /></label>
            <label className="field"><span>Maximum listing price (USD)</span><input className="input" type="number" min="0.01" step="0.01" value={maximum} disabled={submitting} onChange={(e) => { setMaximum(e.target.value); requestKey.current = null; }} /></label>
          </div>
          <p className="t-small muted">Starting authorizes Sello to choose a price within this range and create this eBay listing using your connected seller settings. If a requirement is missing, Sello saves the listing for your review.</p>
        </div>}
        </div>

            {error && (
              <div className="form-section" role="alert">
                <Banner
                  variant="error"
                  title={error}
                  actions={
                    <Btn
                      variant="secondary"
                      size="sm"
                      icon="refresh"
                      onClick={() => void prepare()}
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
                onClick={() => void prepare()}
              >
                {submitting
                  ? "Identifying your item…"
                  : automaticPublish ? "Prepare and post within my price range" : "Prepare my listing"}
              </Btn>
              <div role="status" className="t-small muted" style={{ marginTop: 8 }}>
                {submitting ? "Keep this page open while your photos are identified. Pricing continues in the background once your listing is saved." : automaticPublish ? "Authorization applies only to this item, for the next 24 hours." : "Review before posting. Nothing is published automatically."}
              </div>
            </div>

            <div className="form-section">
              <Banner
                variant="info"
                title="How it works"
                desc={automaticPublish ? "Sello identifies the item, checks pricing and posts to eBay only within your authorized range. Missing requirements are left for your review." : "We upload your photos, identify the product with AI, and prepare an editable listing and price for your review."}
              />
            </div>
          </div>

          <aside className="readiness">
            <div className="card">
              <FormSection
                title="Where it lists"
                desc="Choose where to post when you review the listing."
              >
                <div className="liston">
                  {channels.map((ch) => (
                    <div
                      key={ch.marketplace}
                      className="row"
                      style={{ gap: 12, padding: "10px 10px" }}
                    >
                      <MpLogo id={ch.marketplace} size={28} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="mp-row__name">{ch.name}</div>
                        <div className="mp-row__meta">
                          {ch.capabilities.publish
                            ? "Publishing enabled"
                            : marketplaceCapabilityLabel({
                                marketplace: ch.marketplace,
                                publish: false,
                              })}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="liston__foot">
                    Automatic posting applies only to eBay when you authorize it.
                    Other marketplaces are selected during review.
                  </div>
                </div>
              </FormSection>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
