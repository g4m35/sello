"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LogOut,
  Mail,
  Save,
  Sparkles,
  UploadCloud,
} from "lucide-react";

import { getBrowserSupabase } from "@/lib/supabase/browser";

type Marketplace = "ebay" | "grailed" | "poshmark" | "depop";

type MarketplaceDraft = {
  title: string;
  description: string;
  categoryHint: string;
  tags: string[];
};

type DraftApiResponse = {
  inventoryItem: {
    id: string;
    status: string;
    productName: string;
    brand: string | null;
    category: string;
    condition: string;
    styleCode: string | null;
    colorway: string | null;
    size: string | null;
    confidence: number | null;
    recommendedPriceCents: number | null;
    pricingRationale: string | null;
  };
  draft: {
    id: string;
    status: string;
    title: string;
    description: string;
    bulletPoints: string[];
    recommendedPriceCents: number | null;
    pricingRationale: string | null;
    itemSpecifics: Record<string, string>;
    marketplaceDrafts: Record<Marketplace, MarketplaceDraft>;
    selectedMarketplaces: Marketplace[];
  };
  aiOutput: {
    id: string;
  };
};

type EditableDraft = {
  title: string;
  description: string;
  bulletText: string;
  recommendedPriceCents: number | null;
  selectedMarketplaces: Marketplace[];
};

const marketplaces: { id: Marketplace; label: string }[] = [
  { id: "ebay", label: "eBay" },
  { id: "grailed", label: "Grailed" },
  { id: "poshmark", label: "Poshmark" },
  { id: "depop", label: "Depop" },
];

function formatPrice(cents: number | null) {
  if (!cents) {
    return "Needs comps";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function toPriceInput(cents: number | null) {
  return cents ? (cents / 100).toFixed(2) : "";
}

function parsePriceInput(value: string) {
  const cleaned = value.trim();

  if (!cleaned) {
    return null;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
}

export default function SellerWorkbench() {
  const supabase = useMemo(() => getBrowserSupabase(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [result, setResult] = useState<DraftApiResponse | null>(null);
  const [editableDraft, setEditableDraft] = useState<EditableDraft | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    if (!supabase) {
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const previews = useMemo(
    () =>
      selectedFiles.map((file) => ({
        name: file.name,
        url: URL.createObjectURL(file),
      })),
    [selectedFiles],
  );

  useEffect(
    () => () => {
      for (const preview of previews) {
        URL.revokeObjectURL(preview.url);
      }
    },
    [previews],
  );

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      return;
    }

    setAuthLoading(true);
    setAuthMessage("");
    setError("");

    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    setAuthLoading(false);
    setAuthMessage(signInError ? signInError.message : "Check your email for the sign-in link.");
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setResult(null);
    setEditableDraft(null);
  }

  async function generateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session) {
      setError("Sign in before uploading item photos.");
      return;
    }

    if (selectedFiles.length < 1 || selectedFiles.length > 3) {
      setError("Upload 1 to 3 item photos.");
      return;
    }

    setIsGenerating(true);
    setError("");
    setSaveMessage("");
    setResult(null);
    setEditableDraft(null);

    const formData = new FormData();
    for (const file of selectedFiles) {
      formData.append("photos", file);
    }

    const response = await fetch("/api/listings/draft", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: formData,
    });

    const payload = await response.json();
    setIsGenerating(false);

    if (!response.ok) {
      setError(payload.error ?? "Draft generation failed.");
      return;
    }

    setResult(payload);
    setEditableDraft({
      title: payload.draft.title,
      description: payload.draft.description,
      bulletText: payload.draft.bulletPoints.join("\n"),
      recommendedPriceCents: payload.draft.recommendedPriceCents,
      selectedMarketplaces: ["ebay", "grailed", "poshmark", "depop"],
    });
  }

  async function saveDraft(approve: boolean) {
    if (!session || !result || !editableDraft) {
      return;
    }

    const bulletPoints = editableDraft.bulletText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (editableDraft.selectedMarketplaces.length < 1) {
      setError("Select at least one marketplace before saving.");
      return;
    }

    setIsSaving(true);
    setError("");
    setSaveMessage("");

    const response = await fetch(`/api/listings/draft/${result.draft.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: editableDraft.title,
        description: editableDraft.description,
        bulletPoints,
        recommendedPriceCents: editableDraft.recommendedPriceCents,
        selectedMarketplaces: editableDraft.selectedMarketplaces,
        approve,
      }),
    });

    const payload = await response.json();
    setIsSaving(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not save the draft.");
      return;
    }

    setResult((current) => (current ? { ...current, draft: payload.draft } : current));
    setSaveMessage(
      approve
        ? "Draft approved. Publishing jobs are intentionally not queued in this MVP slice."
        : "Draft saved.",
    );
  }

  function toggleMarketplace(marketplace: Marketplace) {
    setEditableDraft((current) => {
      if (!current) {
        return current;
      }

      const selected = current.selectedMarketplaces.includes(marketplace)
        ? current.selectedMarketplaces.filter((item) => item !== marketplace)
        : [...current.selectedMarketplaces, marketplace];

      return { ...current, selectedMarketplaces: selected };
    });
  }

  return (
    <main className="min-h-screen bg-[#f6f5f0] text-neutral-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-neutral-300 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-red-700">
              AI resale cross-listing MVP
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-neutral-950 sm:text-4xl">
              Streetwear listing workbench
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
              Upload item photos, let Gemini identify the product, then review one master listing
              record before any marketplace publishing exists.
            </p>
          </div>

          <section className="w-full border border-neutral-300 bg-white p-4 shadow-sm lg:max-w-sm">
            {!supabase ? (
              <div className="flex gap-3 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Set Supabase public env vars before using auth.</p>
              </div>
            ) : session ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">Signed in</p>
                  <p className="truncate text-sm font-medium">{session.user.email}</p>
                </div>
                <button
                  type="button"
                  onClick={signOut}
                  className="inline-flex h-10 items-center gap-2 border border-neutral-300 px-3 text-sm font-medium hover:bg-neutral-100"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            ) : (
              <form onSubmit={sendMagicLink} className="flex flex-col gap-3">
                <label className="text-sm font-medium" htmlFor="email">
                  Seller email
                </label>
                <div className="flex gap-2">
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    className="min-w-0 flex-1 border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-red-700"
                    required
                  />
                  <button
                    type="submit"
                    disabled={authLoading}
                    className="inline-flex h-10 items-center gap-2 bg-neutral-950 px-3 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                    Link
                  </button>
                </div>
                {authMessage ? <p className="text-sm text-neutral-600">{authMessage}</p> : null}
              </form>
            )}
          </section>
        </header>

        <div className="grid gap-6 lg:grid-cols-[390px_minmax(0,1fr)]">
          <section className="border border-neutral-300 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">New item</h2>
                <p className="mt-1 text-sm text-neutral-600">Use clear front, tag, and sole/detail photos.</p>
              </div>
              <Sparkles className="h-5 w-5 text-red-700" />
            </div>

            <form onSubmit={generateDraft} className="mt-5 flex flex-col gap-4">
              <label
                htmlFor="photos"
                className="flex min-h-44 cursor-pointer flex-col items-center justify-center border border-dashed border-neutral-400 bg-neutral-50 px-4 py-8 text-center hover:bg-neutral-100"
              >
                <UploadCloud className="h-9 w-9 text-neutral-500" />
                <span className="mt-3 text-sm font-semibold">Upload 1-3 photos</span>
                <span className="mt-1 text-xs text-neutral-500">JPEG, PNG, WEBP, HEIC up to 8MB each</span>
                <input
                  id="photos"
                  name="photos"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    setSelectedFiles(Array.from(event.target.files ?? []).slice(0, 3));
                  }}
                />
              </label>

              {previews.length ? (
                <div className="grid grid-cols-3 gap-2">
                  {previews.map((preview) => (
                    <div key={preview.url} className="overflow-hidden border border-neutral-200 bg-neutral-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={preview.url} alt={preview.name} className="aspect-square w-full object-cover" />
                    </div>
                  ))}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={!session || isGenerating}
                className="inline-flex h-11 items-center justify-center gap-2 bg-red-700 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-400"
              >
                {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Generate draft
              </button>
            </form>

            <div className="mt-5 border-t border-neutral-200 pt-4 text-sm text-neutral-600">
              <p className="font-medium text-neutral-900">MVP boundary</p>
              <p className="mt-1">
                This build does not fake publishing. Approval stops before marketplace jobs are queued.
              </p>
            </div>
          </section>

          <section className="min-h-[620px] border border-neutral-300 bg-white shadow-sm">
            {!result || !editableDraft ? (
              <div className="flex h-full min-h-[620px] flex-col items-center justify-center px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center border border-neutral-300 bg-neutral-50">
                  <UploadCloud className="h-7 w-7 text-neutral-500" />
                </div>
                <h2 className="mt-5 text-xl font-semibold">No draft yet</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-neutral-600">
                  Once Gemini returns validated JSON, the master inventory record and draft editor will appear here.
                </p>
              </div>
            ) : (
              <div className="grid min-h-[620px] lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="p-5 sm:p-6">
                  <div className="flex flex-col gap-4 border-b border-neutral-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">
                        Master inventory #{result.inventoryItem.id.slice(0, 8)}
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold">{result.inventoryItem.productName}</h2>
                      <p className="mt-2 text-sm text-neutral-600">
                        {result.inventoryItem.brand ?? "Unknown brand"} · {result.inventoryItem.category} ·{" "}
                        {result.inventoryItem.condition.replaceAll("_", " ")}
                      </p>
                    </div>
                    <div className="border border-neutral-300 px-3 py-2 text-sm">
                      <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">AI confidence</p>
                      <p className="mt-1 font-semibold">
                        {result.inventoryItem.confidence
                          ? `${Math.round(result.inventoryItem.confidence * 100)}%`
                          : "Unknown"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 sm:grid-cols-3">
                    {[
                      ["Style code", result.inventoryItem.styleCode ?? "Unknown"],
                      ["Colorway", result.inventoryItem.colorway ?? "Unknown"],
                      ["Size", result.inventoryItem.size ?? "Unknown"],
                    ].map(([label, value]) => (
                      <div key={label} className="border border-neutral-200 p-3">
                        <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">{label}</p>
                        <p className="mt-1 text-sm font-medium">{value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 flex flex-col gap-5">
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-semibold">Title</span>
                      <input
                        value={editableDraft.title}
                        onChange={(event) =>
                          setEditableDraft((current) =>
                            current ? { ...current, title: event.target.value } : current,
                          )
                        }
                        className="border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-red-700"
                      />
                    </label>

                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-semibold">Description</span>
                      <textarea
                        value={editableDraft.description}
                        onChange={(event) =>
                          setEditableDraft((current) =>
                            current ? { ...current, description: event.target.value } : current,
                          )
                        }
                        rows={8}
                        className="resize-y border border-neutral-300 px-3 py-2 text-sm leading-6 outline-none focus:border-red-700"
                      />
                    </label>

                    <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_180px]">
                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold">Bullet points</span>
                        <textarea
                          value={editableDraft.bulletText}
                          onChange={(event) =>
                            setEditableDraft((current) =>
                              current ? { ...current, bulletText: event.target.value } : current,
                            )
                          }
                          rows={5}
                          className="resize-y border border-neutral-300 px-3 py-2 text-sm leading-6 outline-none focus:border-red-700"
                        />
                      </label>

                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold">Suggested price</span>
                        <div className="flex items-center border border-neutral-300 focus-within:border-red-700">
                          <span className="px-3 text-sm text-neutral-500">$</span>
                          <input
                            inputMode="decimal"
                            value={toPriceInput(editableDraft.recommendedPriceCents)}
                            onChange={(event) =>
                              setEditableDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      recommendedPriceCents: parsePriceInput(event.target.value),
                                    }
                                  : current,
                              )
                            }
                            className="min-w-0 flex-1 px-0 py-2 pr-3 text-sm outline-none"
                          />
                        </div>
                        <p className="text-xs leading-5 text-neutral-500">
                          {result.draft.pricingRationale ?? "Verify live comps before publishing."}
                        </p>
                      </label>
                    </div>

                    <div>
                      <p className="text-sm font-semibold">Marketplaces</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-4">
                        {marketplaces.map((marketplace) => (
                          <label
                            key={marketplace.id}
                            className="flex cursor-pointer items-center gap-2 border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
                          >
                            <input
                              type="checkbox"
                              checked={editableDraft.selectedMarketplaces.includes(marketplace.id)}
                              onChange={() => toggleMarketplace(marketplace.id)}
                              className="h-4 w-4 accent-red-700"
                            />
                            {marketplace.label}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 border-t border-neutral-200 pt-5 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => saveDraft(false)}
                        disabled={isSaving}
                        className="inline-flex h-11 items-center justify-center gap-2 border border-neutral-300 px-4 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-60"
                      >
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save draft
                      </button>
                      <button
                        type="button"
                        onClick={() => saveDraft(true)}
                        disabled={isSaving}
                        className="inline-flex h-11 items-center justify-center gap-2 bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Approve draft
                      </button>
                    </div>
                  </div>
                </div>

                <aside className="border-t border-neutral-200 bg-neutral-50 p-5 lg:border-l lg:border-t-0">
                  <p className="text-sm font-semibold">Debug trail</p>
                  <dl className="mt-3 space-y-3 text-sm">
                    <div>
                      <dt className="text-xs uppercase tracking-[0.14em] text-neutral-500">AI output</dt>
                      <dd className="mt-1 font-mono text-xs">{result.aiOutput.id}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-[0.14em] text-neutral-500">Price</dt>
                      <dd className="mt-1 font-medium">{formatPrice(editableDraft.recommendedPriceCents)}</dd>
                    </div>
                  </dl>

                  <div className="mt-6">
                    <p className="text-sm font-semibold">Marketplace drafts</p>
                    <div className="mt-3 flex flex-col gap-3">
                      {marketplaces.map((marketplace) => {
                        const draft = result.draft.marketplaceDrafts[marketplace.id];

                        return (
                          <section key={marketplace.id} className="border border-neutral-300 bg-white p-3">
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="text-sm font-semibold">{marketplace.label}</h3>
                              <span className="text-xs text-neutral-500">{draft.categoryHint}</span>
                            </div>
                            <p className="mt-2 text-sm font-medium leading-5">{draft.title}</p>
                            <p className="mt-2 line-clamp-3 text-xs leading-5 text-neutral-600">
                              {draft.description}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {draft.tags.slice(0, 4).map((tag) => (
                                <span key={tag} className="bg-neutral-100 px-2 py-1 text-xs text-neutral-600">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  </div>
                </aside>
              </div>
            )}
          </section>
        </div>

        {error ? (
          <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        ) : null}
        {saveMessage ? (
          <div className="border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {saveMessage}
          </div>
        ) : null}
      </div>
    </main>
  );
}
