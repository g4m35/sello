"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { api, type AutomationSettings } from "@/lib/api/client";
import { Btn } from "@/components/ui/primitives";

export function AutomationSettingsCard({ token }: { token: string }) {
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    api.getAutomationSettings(token).then((result) => {
      if (!active) return;
      setSettings(result);
      setMinimum(result.policy.minPriceCents == null ? "" : String(result.policy.minPriceCents / 100));
      setMaximum(result.policy.maxPriceCents == null ? "" : String(result.policy.maxPriceCents / 100));
      setError("");
    }).catch(() => { if (active) setError("Could not load automation settings. Retry to check their current status."); });
    return () => { active = false; };
  }, [token, reload]);

  async function save(enabled: boolean) {
    if (!settings?.canManage || busy) return;
    const minPriceCents = Math.round(Number(minimum) * 100);
    const maxPriceCents = Math.round(Number(maximum) * 100);
    if (enabled && (!consent || !Number.isSafeInteger(minPriceCents) || minPriceCents <= 0 || !Number.isSafeInteger(maxPriceCents) || maxPriceCents < minPriceCents || maxPriceCents > 10_000_000)) {
      setError("Enter a valid price range and authorize automatic posting."); return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api.saveAutomationSettings(token, enabled
        ? { enabled: true, consent: true, minPriceCents, maxPriceCents, expectedRevision: settings.policy.revision }
        : { enabled: false, expectedRevision: settings.policy.revision });
      setSettings(result); setConsent(false);
      setMessage(enabled ? "Saved. Future uploads and bulk listings will use this authorization." : "Paused. New and pending listings will not post under this authorization. Listings already published stay live.");
    } catch (reason) {
      setError((reason as { error?: string })?.error ?? "Could not save. Reload the settings to check whether the change was applied.");
    } finally { setBusy(false); }
  }

  return <section className="card" id="automation">
    <div className="card__head"><h2 className="card__title">Automatic eBay posting</h2></div>
    <div className="card__body">
      {!settings ? <p role="status">{error || "Loading automation settings…"}</p> : <>
        <p><strong>{settings.policy.enabled ? "On" : "Paused"}</strong> · Applies to new photo uploads and bulk listings. Existing inventory is not published automatically.</p>
        <p className="t-small muted">Sello identifies, prices and posts only when the match, sold comparisons and eBay requirements are satisfied. Anything uncertain stays saved for review.</p>
        <form onSubmit={(event: FormEvent) => { event.preventDefault(); void save(true); }} className="stack-3" style={{ marginTop: 16 }}>
          <div className="form-grid form-grid--2">
            <label className="field"><span>Minimum price (USD)</span><input className="input" type="number" min="0.01" max="100000" step="0.01" required value={minimum} disabled={!settings.canManage || busy} onChange={(event) => { setMinimum(event.target.value); setConsent(false); }} /></label>
            <label className="field"><span>Maximum price (USD)</span><input className="input" type="number" min="0.01" max="100000" step="0.01" required value={maximum} disabled={!settings.canManage || busy} onChange={(event) => { setMaximum(event.target.value); setConsent(false); }} /></label>
          </div>
          {settings.canManage ? <>
            <label className="automation-choice"><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} /><span>I authorize Sello to price and post future listings to eBay within this range using my connected seller settings, until I pause or change this authorization.</span></label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <Btn type="submit" variant="accent" disabled={busy || !consent}>{busy ? "Saving…" : settings.policy.enabled ? "Save authorization" : "Enable automatic posting"}</Btn>
              {settings.policy.enabled && <Btn type="button" variant="secondary" disabled={busy} onClick={() => void save(false)}>Pause automatic posting</Btn>}
            </div>
          </> : <p className="t-small muted">The account owner manages this authorization.</p>}
        </form>
        <p className="t-small muted" style={{ marginTop: 12 }}>Pausing cannot cancel a marketplace request already sent. <Link href="/settings/marketplaces">Check eBay connection and selling setup</Link>.</p>
      </>}
      {settings && error && <p role="alert">{error}</p>}
      {error && <Btn variant="secondary" disabled={busy} onClick={() => { setConsent(false); setReload((value) => value + 1); }}>Reload settings</Btn>}
      {message && <p role="status">{message}</p>}
    </div>
  </section>;
}

export function AutomationDefaultNotice({ token }: { token: string }) {
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    api.getAutomationSettings(token).then((value) => { if (active) setSettings(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [token]);
  return <p className="t-small" role="status">{settings
    ? settings.policy.enabled ? `Automatic eBay posting is on for newly generated listings, within $${(settings.policy.minPriceCents! / 100).toFixed(2)}–$${(settings.policy.maxPriceCents! / 100).toFixed(2)} USD.` : "Automatic posting is paused. New listings will be prepared for review."
    : failed ? "Automation status is unavailable. Check your saved settings before generating listings." : "Checking saved automation settings…"} <Link href="/settings#automation">Manage automation</Link></p>;
}
