"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";
import { Banner, Btn } from "@/components/ui/primitives";
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
  const [dragging, setDragging] = useState(false);

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
  return <>
    <Topbar crumbs={["Inventory", "New listing"]} right={<Btn variant="ghost" disabled={submitting} onClick={() => router.push("/inventory")}>Cancel</Btn>} />
    <main className="page upload-page">
      <div className="page__head"><div><h1 className="page__title">Photos in. <em>Listing prepared.</em></h1><p className="page__title-meta">Sello identifies the item, writes the listing, and looks for comparable sales.</p></div></div>
      <section className="card upload-card stack-4" aria-label="Create listing from photos">
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <div onDragOver={(e) => { e.preventDefault(); if (!submitting) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }} className={dragging ? "upload-drop upload-drop--active" : "upload-drop"}>
          {previews.length === 0 ? <button className="dropzone" disabled={submitting} onClick={() => input.current?.click()}><Icon name="image" size={32} /><strong>Upload photos</strong><span>Drop up to 3 photos here, or choose from your device.</span><span className="t-small muted">Include the item, size label, and any visible wear. Up to 8MB each.</span></button> : <div className="images">
            {previews.map((p, i) => <div key={p.url} className="image-tile">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Item photo ${i + 1}`} />
              {i === 0 && <span className="image-tile__badge">Cover</span>}
              <button className="image-tile__remove" aria-label={`Remove photo ${i + 1}`} disabled={submitting} onClick={() => remove(i)}><Icon name="x" size={16} /></button>
            </div>)}
            {previews.length < MAX_FILES && <button className="image-tile image-tile--add" disabled={submitting} onClick={() => input.current?.click()}><Icon name="plus" size={24} />Add photo</button>}
          </div>}
        </div>
        <label className="automation-choice"><input type="checkbox" checked={automaticPublish} disabled={submitting} onChange={(e) => { setAutomaticPublish(e.target.checked); requestKey.current = null; }} /><span><strong>Post to eBay automatically</strong><span className="t-small muted">Only with a confident match, reliable sold comparisons, and your authorized price range. Other marketplaces are selected during review.</span></span></label>
        {automaticPublish && <div className="stack-3">
          <div className="form-grid form-grid--2">
            <label className="field"><span>Minimum listing price (USD)</span><input className="input" type="number" min="0.01" step="0.01" value={minimum} disabled={submitting} onChange={(e) => { setMinimum(e.target.value); requestKey.current = null; }} /></label>
            <label className="field"><span>Maximum listing price (USD)</span><input className="input" type="number" min="0.01" step="0.01" value={maximum} disabled={submitting} onChange={(e) => { setMaximum(e.target.value); requestKey.current = null; }} /></label>
          </div>
          <p className="t-small muted">Starting authorizes Sello to choose a price within this range and create this eBay listing using your connected seller settings. If a requirement is missing, Sello saves the listing for your review.</p>
        </div>}
        {error && <div role="alert"><Banner variant="error" title={error} /></div>}
        <div className="stack-2"><Btn variant="accent" size="lg" icon="spark" disabled={!previews.length || submitting} onClick={() => void prepare()}>{submitting ? "Identifying your item…" : automaticPublish ? "Prepare and post within my price range" : "Prepare my listing"}</Btn><p role="status" className="t-small muted">{submitting ? "Keep this page open while your photos are identified. Pricing continues in the background once your listing is saved." : automaticPublish ? "Authorization applies only to this item, for the next 24 hours." : "Review before posting. Nothing is published automatically."}</p></div>
      </section>
    </main>
  </>;
}
