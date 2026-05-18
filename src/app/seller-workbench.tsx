"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Copy,
  DollarSign,
  Home,
  Loader2,
  LogOut,
  Mail,
  PackageCheck,
  RotateCcw,
  Save,
  Settings,
  Sparkles,
  Store,
  UploadCloud,
} from "lucide-react";

import { getBrowserSupabase } from "@/lib/supabase/browser";
import CompsPanel from "./comps-panel";

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
    updatedAt?: string;
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

type SaveState = "idle" | "loading" | "saved" | "dirty" | "saving" | "error";

type AppSection = "dashboard" | "workbench" | "inventory" | "pricing" | "channels" | "jobs" | "account";

const marketplaces: { id: Marketplace; label: string }[] = [
  { id: "ebay", label: "eBay" },
  { id: "grailed", label: "Grailed" },
  { id: "poshmark", label: "Poshmark" },
  { id: "depop", label: "Depop" },
];

const navItems: { id: AppSection; label: string; icon: typeof Home }[] = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "workbench", label: "Workbench", icon: Sparkles },
  { id: "inventory", label: "Inventory", icon: Boxes },
  { id: "pricing", label: "Pricing", icon: DollarSign },
  { id: "channels", label: "Channels", icon: Store },
  { id: "jobs", label: "Jobs", icon: ClipboardList },
  { id: "account", label: "Account", icon: Settings },
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

function toEditableDraft(payload: DraftApiResponse): EditableDraft {
  return {
    title: payload.draft.title,
    description: payload.draft.description,
    bulletText: payload.draft.bulletPoints.join("\n"),
    recommendedPriceCents: payload.draft.recommendedPriceCents,
    selectedMarketplaces: payload.draft.selectedMarketplaces,
  };
}

function getDraftSignature(draft: EditableDraft | null) {
  return draft ? JSON.stringify(draft) : "";
}

function getBulletPoints(draft: EditableDraft) {
  return draft.bulletText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function getRequiredFieldIssues(draft: EditableDraft | null) {
  if (!draft) {
    return ["Generate or load a draft before editing."];
  }

  const issues: string[] = [];
  const bulletPoints = getBulletPoints(draft);

  if (draft.title.trim().length < 10) {
    issues.push("Title needs at least 10 characters.");
  }

  if (draft.description.trim().length < 20) {
    issues.push("Description needs at least 20 characters.");
  }

  if (bulletPoints.length < 3) {
    issues.push("Add at least 3 bullet points.");
  }

  if (draft.selectedMarketplaces.length < 1) {
    issues.push("Select at least one marketplace.");
  }

  return issues;
}

function getPlatformWarnings(result: DraftApiResponse | null, draft: EditableDraft | null) {
  if (!result || !draft) {
    return [];
  }

  const warnings: string[] = [];
  const selected = new Set(draft.selectedMarketplaces);
  const sizeMissing = !result.inventoryItem.size || result.inventoryItem.size === "Unknown";
  const priceMissing = !draft.recommendedPriceCents;

  if (selected.has("ebay")) {
    if (draft.title.trim().length > 80) warnings.push("eBay title must stay under 80 characters.");
    if (priceMissing) warnings.push("eBay needs a seller price before publishing.");
    if (sizeMissing) warnings.push("eBay sneaker listings usually need size.");
  }

  if (selected.has("grailed")) {
    if (sizeMissing) warnings.push("Grailed needs size for footwear and apparel.");
    if (!result.inventoryItem.brand) warnings.push("Grailed needs a designer/brand.");
  }

  if (selected.has("poshmark")) {
    if (priceMissing) warnings.push("Poshmark needs a listing price.");
    if (sizeMissing) warnings.push("Poshmark needs size.");
  }

  if (selected.has("depop")) {
    const depopTags = result.draft.marketplaceDrafts.depop?.tags ?? [];
    if (depopTags.length < 3) warnings.push("Depop works best with at least 3 tags.");
    if (priceMissing) warnings.push("Depop needs a listing price.");
  }

  return warnings;
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
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDraftActionRunning, setIsDraftActionRunning] = useState(false);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [activeSection, setActiveSection] = useState<AppSection>("account");
  const lastSavedSignature = useRef("");
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (!nextSession) {
        setResult(null);
        setEditableDraft(null);
        setSaveState("idle");
        lastSavedSignature.current = "";
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!session) {
      lastSavedSignature.current = "";
      return;
    }

    let cancelled = false;
    const currentSession = session;

    async function loadLatestDraft() {
      setSaveState("loading");
      setError("");

      const response = await fetch("/api/listings/draft", {
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`,
        },
      });
      const payload = await response.json();

      if (cancelled) {
        return;
      }

      if (!response.ok) {
        setSaveState("error");
        setError(payload.error ?? "Could not load your latest draft.");
        return;
      }

      if (!payload.draft) {
        setResult(null);
        setEditableDraft(null);
        setSaveState("idle");
        lastSavedSignature.current = "";
        return;
      }

      setResult(payload);
      const nextEditable = toEditableDraft(payload);
      setEditableDraft(nextEditable);
      lastSavedSignature.current = getDraftSignature(nextEditable);
      setSaveState("saved");
    }

    void loadLatestDraft();

    return () => {
      cancelled = true;
    };
  }, [session]);

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
    const nextEditable = toEditableDraft(payload);
    setEditableDraft(nextEditable);
    lastSavedSignature.current = getDraftSignature(nextEditable);
    setSaveState("saved");
    setActiveSection("workbench");
  }

  const persistDraft = useCallback(async (approve: boolean, options?: { silent?: boolean }) => {
    if (!session || !result || !editableDraft) {
      return;
    }

    const bulletPoints = getBulletPoints(editableDraft);

    if (approve) {
      const issues = getRequiredFieldIssues(editableDraft);

      if (issues.length) {
        setSaveState("dirty");
        setError(issues[0]);
        return;
      }
    }

    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
    }

    if (!options?.silent) {
      setIsSaving(true);
      setSaveMessage("");
    }

    setSaveState("saving");
    setError("");

    const draftToSave = editableDraft;
    const nextSignature = getDraftSignature(draftToSave);

    try {
      const response = await fetch(`/api/listings/draft/${result.draft.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: draftToSave.title,
          description: draftToSave.description,
          bulletPoints,
          recommendedPriceCents: draftToSave.recommendedPriceCents,
          selectedMarketplaces: draftToSave.selectedMarketplaces,
          approve,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not save the draft.");
      }

      setResult((current) => (current ? { ...current, draft: payload.draft } : current));
      lastSavedSignature.current = nextSignature;
      setSaveState("saved");

      if (!options?.silent) {
        setSaveMessage(
          approve
            ? "Draft approved. Publishing jobs are intentionally not queued in this MVP slice."
            : "Draft saved.",
        );
      }
    } catch (saveError) {
      setSaveState("error");
      setError(saveError instanceof Error ? saveError.message : "Could not save the draft.");
    } finally {
      if (!options?.silent) {
        setIsSaving(false);
      }
    }
  }, [editableDraft, result, session]);

  useEffect(() => {
    if (!session || !result || !editableDraft) {
      return;
    }

    const nextSignature = getDraftSignature(editableDraft);

    if (!lastSavedSignature.current || nextSignature === lastSavedSignature.current) {
      return;
    }

    setSaveState("dirty");

    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
    }

    autosaveTimer.current = setTimeout(() => {
      void persistDraft(false, { silent: true });
    }, 900);

    return () => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
      }
    };
  }, [editableDraft, persistDraft, result, session]);

  async function runDraftAction(action: "reset" | "duplicate") {
    if (!session || !result) {
      return;
    }

    setIsDraftActionRunning(true);
    setError("");
    setSaveMessage("");

    const response = await fetch(`/api/listings/draft/${result.draft.id}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action }),
    });

    const payload = await response.json();
    setIsDraftActionRunning(false);

    if (!response.ok) {
      setSaveState("error");
      setError(payload.error ?? `Could not ${action} the draft.`);
      return;
    }

    setResult(payload);
    const nextEditable = toEditableDraft(payload);
    setEditableDraft(nextEditable);
    lastSavedSignature.current = getDraftSignature(nextEditable);
    setSaveState("saved");
    setSaveMessage(action === "reset" ? "Draft reset to the validated AI output." : "Draft duplicated.");
  }

  async function saveDraft(approve: boolean) {
    await persistDraft(approve);
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

  const hasDraft = Boolean(result && editableDraft);
  const requiredIssues = useMemo(() => getRequiredFieldIssues(editableDraft), [editableDraft]);
  const platformWarnings = useMemo(() => getPlatformWarnings(result, editableDraft), [result, editableDraft]);
  const canApprove = hasDraft && requiredIssues.length === 0;
  const saveStateLabel =
    saveState === "loading"
      ? "Loading draft"
      : saveState === "dirty"
        ? "Unsaved changes"
        : saveState === "saving"
          ? "Autosaving"
          : saveState === "saved"
            ? "Saved"
            : saveState === "error"
              ? "Save failed"
              : "No draft";

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f6f5f0] text-neutral-950">
      <div className="grid min-h-screen min-w-0 max-w-full lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="min-w-0 overflow-hidden border-b border-neutral-300 bg-neutral-950 text-white lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-3 px-4 py-3 lg:flex-col lg:items-start lg:px-5 lg:py-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-300">Resale OS</p>
              <h1 className="mt-1 text-lg font-semibold">Cross-listing</h1>
            </div>
            <div className="hidden rounded-none border border-white/15 px-3 py-2 text-xs text-neutral-300 lg:block">
              MVP build
            </div>
          </div>
          <nav className="flex max-w-full gap-1 overflow-x-auto border-t border-white/10 px-3 py-2 lg:flex-col lg:overflow-visible lg:px-3">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className={`inline-flex h-10 shrink-0 items-center gap-2 px-3 text-sm font-medium transition ${
                    active ? "bg-white text-neutral-950" : "text-neutral-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 max-w-full">
          <header className="border-b border-neutral-200 bg-white px-4 py-3 shadow-sm sm:px-6 lg:px-8">
            <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-red-700">
                  AI resale cross-listing MVP
                </p>
                <h2 className="mt-0.5 text-2xl font-semibold tracking-normal text-neutral-950 sm:text-3xl">
                  {navItems.find((item) => item.id === activeSection)?.label}
                </h2>
                <p className="mt-1 max-w-2xl text-sm leading-5 text-neutral-600">
                  Upload photos, generate a validated Gemini draft, edit one master record, then
                  prepare channel-specific listings without faking publishing.
                </p>
              </div>
            </div>
          </header>

          <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
            {activeSection === "dashboard" ? (
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Draft status", hasDraft ? saveStateLabel : "Awaiting item", hasDraft ? "Refresh-safe autosave" : "Upload 1-3 photos"],
                ["Price", result ? formatPrice(editableDraft?.recommendedPriceCents ?? null) : "No item", "Manual until comps API"],
                ["Channels", hasDraft ? `${editableDraft?.selectedMarketplaces.length ?? 0} selected` : "4 available", "eBay, Grailed, Poshmark, Depop"],
                ["Queue", "Idle", "Publishing disabled in MVP"],
              ].map(([label, value, note]) => (
                <div key={label} className="border border-neutral-300 bg-white p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">{label}</p>
                  <p className="mt-2 text-xl font-semibold">{value}</p>
                  <p className="mt-1 text-sm text-neutral-500">{note}</p>
                </div>
              ))}
            </section>
            ) : null}

            {activeSection === "dashboard" ? (
              <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="border border-neutral-300 bg-white p-5">
                  <h3 className="text-lg font-semibold">Today&apos;s workflow</h3>
                  <div className="mt-5 grid gap-3">
                    {[
                      ["1", "Upload photos", selectedFiles.length ? `${selectedFiles.length} photo selected` : "Waiting"],
                      ["2", "Generate listing draft", hasDraft ? "Complete" : "Pending"],
                      ["3", "Set price", editableDraft?.recommendedPriceCents ? "Manual price set" : "Needs comps/manual price"],
                      ["4", "Approve listing", result?.draft.status === "APPROVED" ? "Approved" : "Not approved"],
                    ].map(([step, title, status]) => (
                      <div key={step} className="flex items-center justify-between gap-4 border border-neutral-200 p-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center bg-neutral-950 text-sm font-semibold text-white">
                            {step}
                          </span>
                          <p className="font-medium">{title}</p>
                        </div>
                        <p className="text-sm text-neutral-500">{status}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border border-neutral-300 bg-white p-5">
                  <h3 className="text-lg font-semibold">Current item</h3>
                  {result ? (
                    <div className="mt-4">
                      <p className="text-sm uppercase tracking-[0.14em] text-neutral-500">
                        #{result.inventoryItem.id.slice(0, 8)}
                      </p>
                      <p className="mt-2 text-xl font-semibold">{result.inventoryItem.productName}</p>
                      <p className="mt-2 text-sm text-neutral-600">
                        {result.inventoryItem.brand ?? "Unknown brand"} · {result.inventoryItem.category}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm leading-6 text-neutral-600">
                      No master inventory record in this session yet. Start in Workbench.
                    </p>
                  )}
                </div>
              </section>
            ) : null}

            {activeSection === "workbench" ? (
              <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="border border-neutral-300 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">New item</h2>
                <p className="mt-1 text-sm text-neutral-600">Use clear front, tag, and sole/detail photos.</p>
              </div>
              <Sparkles className="h-5 w-5 text-red-700" />
            </div>

            <form onSubmit={generateDraft} className="mt-4 flex flex-col gap-3">
              <label
                htmlFor="photos"
                className="flex min-h-36 cursor-pointer flex-col items-center justify-center border border-dashed border-neutral-400 bg-neutral-50 px-4 py-6 text-center hover:bg-neutral-100"
              >
                <UploadCloud className="h-8 w-8 text-neutral-500" />
                <span className="mt-2 text-sm font-semibold">Upload 1-3 photos</span>
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
              {!session ? (
                <button
                  type="button"
                  onClick={() => setActiveSection("account")}
                  className="inline-flex h-10 items-center justify-center gap-2 border border-neutral-300 px-3 text-sm font-semibold hover:bg-neutral-50"
                >
                  <Mail className="h-4 w-4" />
                  Sign in from Account
                </button>
              ) : null}
            </form>

            <div className="mt-4 border-t border-neutral-100 pt-3 text-sm text-neutral-600">
              <p className="font-medium text-neutral-900">MVP boundary</p>
              <p className="mt-1">
                This build does not fake publishing. Approval stops before marketplace jobs are queued.
              </p>
            </div>
          </section>

          <section className="min-h-72 border border-neutral-300 bg-white shadow-sm lg:min-h-[clamp(460px,calc(100vh-178px),620px)]">
            {!result || !editableDraft ? (
              <div className="flex h-full min-h-72 flex-col items-center justify-center px-6 text-center lg:min-h-[clamp(460px,calc(100vh-178px),620px)]">
                {saveState === "loading" ? (
                  <>
                    <Loader2 className="h-8 w-8 animate-spin text-neutral-500" />
                    <h2 className="mt-5 text-xl font-semibold">Loading latest draft</h2>
                    <p className="mt-2 max-w-md text-sm leading-6 text-neutral-600">
                      Checking the database so refreshes reopen the last saved editor state.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex h-14 w-14 items-center justify-center border border-neutral-300 bg-neutral-50">
                      <UploadCloud className="h-7 w-7 text-neutral-500" />
                    </div>
                    <h2 className="mt-5 text-xl font-semibold">No draft yet</h2>
                    <p className="mt-2 max-w-md text-sm leading-6 text-neutral-600">
                      Once Gemini returns validated JSON, the master inventory record and draft editor will appear here.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="grid min-h-72 lg:min-h-[clamp(460px,calc(100vh-178px),620px)] 2xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4 border-b border-neutral-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
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
                    <div className="grid gap-2 sm:min-w-44">
                      <div className="border border-neutral-300 px-3 py-2 text-sm">
                        <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">AI confidence</p>
                        <p className="mt-1 font-semibold">
                          {result.inventoryItem.confidence
                            ? `${Math.round(result.inventoryItem.confidence * 100)}%`
                            : "Unknown"}
                        </p>
                      </div>
                      <div
                        className={`border px-3 py-2 text-sm ${
                          saveState === "error"
                            ? "border-red-300 bg-red-50 text-red-800"
                            : saveState === "dirty"
                              ? "border-amber-300 bg-amber-50 text-amber-900"
                              : "border-emerald-300 bg-emerald-50 text-emerald-900"
                        }`}
                      >
                        <p className="text-xs uppercase tracking-[0.14em]">Autosave</p>
                        <p className="mt-1 font-semibold">{saveStateLabel}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
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

                  <div className="mt-4 flex flex-col gap-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                        <p className="font-semibold">Required before approval</p>
                        {requiredIssues.length ? (
                          <ul className="mt-2 list-disc space-y-1 pl-4">
                            {requiredIssues.map((issue) => (
                              <li key={issue}>{issue}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2">All required master fields are ready.</p>
                        )}
                      </div>
                      <div className="border border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-800">
                        <p className="font-semibold">Platform warnings</p>
                        {platformWarnings.length ? (
                          <ul className="mt-2 list-disc space-y-1 pl-4">
                            {platformWarnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2">No selected-channel warnings.</p>
                        )}
                      </div>
                    </div>

                    <label className="flex flex-col gap-2" htmlFor="draft-title">
                      <span className="text-sm font-semibold">Title</span>
                      <input
                        id="draft-title"
                        value={editableDraft.title}
                        onChange={(event) =>
                          setEditableDraft((current) =>
                            current ? { ...current, title: event.target.value } : current,
                          )
                        }
                        className="border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-red-700"
                      />
                    </label>

                    <label className="flex flex-col gap-2" htmlFor="draft-description">
                      <span className="text-sm font-semibold">Description</span>
                      <textarea
                        id="draft-description"
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
                      <label className="flex flex-col gap-2" htmlFor="draft-bullets">
                        <span className="text-sm font-semibold">Bullet points</span>
                        <textarea
                          id="draft-bullets"
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

                      <label className="flex flex-col gap-2" htmlFor="draft-price">
                        <span className="text-sm font-semibold">Suggested price</span>
                        <div className="flex items-center border border-neutral-300 focus-within:border-red-700">
                          <span className="px-3 text-sm text-neutral-500">$</span>
                          <input
                            id="draft-price"
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

                    <div className="border-t border-neutral-100 pt-4">
                      <p className="text-sm font-semibold">Pricing comps</p>
                      <p className="mt-1 text-xs text-neutral-500">
                        Add sold comps to guide the price. You still set the final number above.
                      </p>
                      {session ? (
                        <div className="mt-3">
                          <CompsPanel
                            accessToken={session.access_token}
                            inventoryItemId={result.inventoryItem.id}
                          />
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-col gap-3 border-t border-neutral-100 pt-4 sm:flex-row sm:flex-wrap">
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
                        onClick={() => runDraftAction("reset")}
                        disabled={isDraftActionRunning || isSaving}
                        className="inline-flex h-11 items-center justify-center gap-2 border border-neutral-300 px-4 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-60"
                      >
                        {isDraftActionRunning ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RotateCcw className="h-4 w-4" />
                        )}
                        Reset to AI draft
                      </button>
                      <button
                        type="button"
                        onClick={() => runDraftAction("duplicate")}
                        disabled={isDraftActionRunning || isSaving}
                        className="inline-flex h-11 items-center justify-center gap-2 border border-neutral-300 px-4 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-60"
                      >
                        <Copy className="h-4 w-4" />
                        Duplicate draft
                      </button>
                      <button
                        type="button"
                        onClick={() => saveDraft(true)}
                        disabled={isSaving || !canApprove}
                        className="inline-flex h-11 items-center justify-center gap-2 bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Approve draft
                      </button>
                    </div>
                  </div>
                </div>

                <aside className="border-t border-neutral-100 bg-neutral-50 p-4 2xl:border-l 2xl:border-t-0">
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
            ) : null}

            {activeSection === "inventory" ? (
              <section className="border border-neutral-300 bg-white">
                <div className="border-b border-neutral-200 p-5">
                  <h3 className="text-lg font-semibold">Master inventory</h3>
                  <p className="mt-1 text-sm text-neutral-600">
                    One canonical item record controls every marketplace draft.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-[0.14em] text-neutral-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Item</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Price</th>
                        <th className="px-4 py-3 font-medium">Channels</th>
                        <th className="px-4 py-3 font-medium">AI output</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result ? (
                        <tr className="border-b border-neutral-100">
                          <td className="px-4 py-4">
                            <p className="font-medium">{result.inventoryItem.productName}</p>
                            <p className="mt-1 text-xs text-neutral-500">
                              {result.inventoryItem.brand ?? "Unknown"} · {result.inventoryItem.styleCode ?? "No style code"}
                            </p>
                          </td>
                          <td className="px-4 py-4">{result.inventoryItem.status}</td>
                          <td className="px-4 py-4">{formatPrice(editableDraft?.recommendedPriceCents ?? null)}</td>
                          <td className="px-4 py-4">{editableDraft?.selectedMarketplaces.join(", ")}</td>
                          <td className="px-4 py-4 font-mono text-xs">{result.aiOutput.id.slice(0, 8)}</td>
                        </tr>
                      ) : (
                        <tr>
                          <td className="px-4 py-8 text-neutral-500" colSpan={5}>
                            No inventory records loaded in this session.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {activeSection === "pricing" ? (
              <section className="flex flex-col gap-5">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="border border-neutral-300 bg-white p-5">
                    <h3 className="text-lg font-semibold">Pricing workspace</h3>
                    <p className="mt-1 text-sm text-neutral-600">
                      Add real sold comps to compute guidance prices. The app never invents a
                      resale price without comps.
                    </p>
                    {editableDraft ? (
                      <label className="mt-5 flex max-w-xs flex-col gap-2">
                        <span className="text-sm font-semibold">Seller price (override)</span>
                        <div className="flex items-center border border-neutral-300 focus-within:border-red-700">
                          <span className="px-3 text-sm text-neutral-500">$</span>
                          <input
                            inputMode="decimal"
                            value={toPriceInput(editableDraft.recommendedPriceCents)}
                            onChange={(event) =>
                              setEditableDraft((current) =>
                                current
                                  ? { ...current, recommendedPriceCents: parsePriceInput(event.target.value) }
                                  : current,
                              )
                            }
                            className="min-w-0 flex-1 px-0 py-2 pr-3 text-sm outline-none"
                          />
                        </div>
                        <span className="text-xs text-neutral-500">
                          You set the final price. Comps below are guidance, not auto-applied.
                        </span>
                      </label>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActiveSection("workbench")}
                        className="mt-5 inline-flex h-10 items-center bg-neutral-950 px-4 text-sm font-semibold text-white"
                      >
                        Start a draft
                      </button>
                    )}
                  </div>
                  <aside className="border border-neutral-300 bg-white p-5">
                    <h3 className="text-lg font-semibold">Live comps API</h3>
                    <p className="mt-4 text-sm leading-6 text-neutral-600">
                      Automated StockX/GOAT/eBay sold data is not connected. Until then, enter
                      comps you have verified yourself. &ldquo;Needs comps&rdquo; is expected
                      with zero comps.
                    </p>
                  </aside>
                </div>
                {session && result ? (
                  <CompsPanel
                    accessToken={session.access_token}
                    inventoryItemId={result.inventoryItem.id}
                  />
                ) : (
                  <div className="border border-neutral-300 bg-white p-5 text-sm text-neutral-600">
                    Start a draft to attach price comps to the master inventory item.
                  </div>
                )}
              </section>
            ) : null}

            {activeSection === "channels" ? (
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {marketplaces.map((marketplace) => (
                  <div key={marketplace.id} className="border border-neutral-300 bg-white p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold">{marketplace.label}</h3>
                      <Store className="h-5 w-5 text-red-700" />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-neutral-600">
                      Draft generation is available. Publishing is intentionally disabled until official/API or Playwright workers are added.
                    </p>
                    <p className="mt-4 text-xs uppercase tracking-[0.14em] text-neutral-500">Status</p>
                    <p className="mt-1 font-medium">Draft only</p>
                  </div>
                ))}
              </section>
            ) : null}

            {activeSection === "jobs" ? (
              <section className="border border-neutral-300 bg-white p-5">
                <h3 className="text-lg font-semibold">Background jobs</h3>
                <div className="mt-5 grid gap-3">
                  {[
                    ["marketplace-publish", "Ready for next slice", "BullMQ schema exists; workers not implemented"],
                    ["inventory-sync", "Ready for next slice", "Delist-on-sale workflow will run here"],
                  ].map(([queue, status, note]) => (
                    <div key={queue} className="grid gap-3 border border-neutral-200 p-4 sm:grid-cols-[220px_180px_minmax(0,1fr)]">
                      <p className="font-mono text-sm">{queue}</p>
                      <p className="text-sm font-medium">{status}</p>
                      <p className="text-sm text-neutral-600">{note}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {activeSection === "account" ? (
              <section className="grid gap-5 lg:grid-cols-2">
                <div className="border border-neutral-300 bg-white p-5">
                  <h3 className="text-lg font-semibold">Account</h3>
                  {!supabase ? (
                    <div className="mt-4 flex gap-3 text-sm text-red-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <p>Set Supabase public env vars before using auth.</p>
                    </div>
                  ) : session ? (
                    <div className="mt-4 flex items-center justify-between gap-3 border border-neutral-200 p-3">
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
                    <form onSubmit={sendMagicLink} className="mt-4 flex flex-col gap-3">
                      <label className="text-sm font-medium" htmlFor="email">
                        Seller email
                      </label>
                      <div className="flex flex-col gap-2 sm:flex-row">
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
                          className="inline-flex h-10 items-center justify-center gap-2 bg-neutral-950 px-3 text-sm font-medium text-white disabled:opacity-60"
                        >
                          {authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                          Send link
                        </button>
                      </div>
                      {authMessage ? <p className="text-sm text-neutral-600">{authMessage}</p> : null}
                    </form>
                  )}
                </div>
                <div className="border border-neutral-300 bg-white p-5">
                  <h3 className="text-lg font-semibold">Service health</h3>
                  <div className="mt-4 space-y-3 text-sm">
                    {["Supabase Auth", "Supabase Storage", "Postgres", "Gemini", "Redis"].map((service) => (
                      <div key={service} className="flex items-center justify-between border border-neutral-200 p-3">
                        <span>{service}</span>
                        <span className="inline-flex items-center gap-2 text-emerald-700">
                          <PackageCheck className="h-4 w-4" />
                          Configured
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border border-neutral-300 bg-white p-5 lg:col-span-2">
                  <h3 className="text-lg font-semibold">MVP boundaries</h3>
                  <ul className="mt-4 space-y-3 text-sm leading-6 text-neutral-600">
                    <li>Marketplace publishing is not faked.</li>
                    <li>Live resale comps are not connected yet.</li>
                    <li>AI JSON is stored and validated before use.</li>
                    <li>Approval currently stops before queueing publish jobs.</li>
                  </ul>
                </div>
              </section>
            ) : null}

        {error ? (
          <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        ) : null}
        {saveMessage ? (
          <div className="border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {saveMessage}
          </div>
        ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
