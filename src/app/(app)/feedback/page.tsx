"use client";

import { useState } from "react";

import { Topbar } from "@/components/app/topbar";
import { Banner, Btn } from "@/components/ui/primitives";
import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";

const TYPES = [
  ["bug", "Bug"],
  ["confusion", "Confusing flow"],
  ["pricing_issue", "Pricing / comps issue"],
  ["marketplace_issue", "Marketplace issue"],
  ["feature_request", "Feature request"],
  ["other", "Other"],
] as const;

const SEVERITIES = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
] as const;

const MARKETPLACES = [
  ["", "Not marketplace-specific"],
  ["ebay", "eBay"],
  ["grailed", "Grailed"],
  ["poshmark", "Poshmark"],
  ["depop", "Depop"],
  ["mercari", "Mercari"],
  ["other", "Other"],
] as const;

export default function FeedbackPage() {
  const { token } = useSession();
  const [type, setType] = useState("bug");
  const [severity, setSeverity] = useState("medium");
  const [marketplace, setMarketplace] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageUrl = typeof window !== "undefined" ? window.location.pathname : null;

  async function submit() {
    if (subject.trim().length === 0 || message.trim().length === 0) {
      setError("Add a subject and a message.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.submitFeedback(token, {
        type,
        severity,
        marketplace: marketplace || null,
        subject: subject.trim(),
        message: message.trim(),
        pageUrl,
      });
      setDone(true);
      setSubject("");
      setMessage("");
    } catch (e) {
      setError((e as { error?: string })?.error ?? "Could not send feedback. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Topbar crumbs={["Feedback"]} />
      <div className="page stack-4" style={{ maxWidth: 640 }}>
        <div className="stack-1">
          <h1 className="t-h2">Send feedback</h1>
          <p className="t-small muted">
            Report bugs, confusing flows, pricing issues, or marketplace problems.
            Sello is in early access. Feedback directly shapes what gets built next.
          </p>
        </div>

        {done ? (
          <Banner
            variant="info"
            title="Feedback sent."
            desc="Thank you. We read every note."
            actions={
              <Btn variant="secondary" size="sm" onClick={() => setDone(false)}>
                Send another
              </Btn>
            }
          />
        ) : (
          <div className="stack-3">
            {error && <div className="t-small danger">{error}</div>}
            <div className="form-grid form-grid--2" style={{ gap: 12 }}>
              <label className="field">
                <span>Type</span>
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {TYPES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Severity</span>
                <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                  {SEVERITIES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Marketplace (optional)</span>
              <select value={marketplace} onChange={(e) => setMarketplace(e.target.value)}>
                {MARKETPLACES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Subject</span>
              <input
                value={subject}
                maxLength={200}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Short summary"
              />
            </label>
            <label className="field">
              <span>Message</span>
              <textarea
                value={message}
                maxLength={5000}
                rows={6}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What happened? What did you expect?"
              />
            </label>
            <div>
              <Btn variant="primary" onClick={submit} disabled={saving}>
                {saving ? "Sending…" : "Send feedback"}
              </Btn>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
