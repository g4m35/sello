"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { Banner, Btn } from "@/components/ui/primitives";

export function ListingAutomationStatus({ itemId, token, onComplete }: { itemId: string; token: string; onComplete: () => void }) {
  const [job, setJob] = useState<{ status: string; message: string; recoveryAction?: "retry_preparation" | null } | null>(null);
  const [error, setError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [revision, setRevision] = useState(0);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let wasRunning = false;
    async function poll() {
      try {
        const result = await api.getListingAutomation(token, itemId);
        if (!active) return;
        setJob(result.job);
        setError(false);
        const running = result.job?.status === "QUEUED" || result.job?.status === "RUNNING";
        if (running) { wasRunning = true; timer = setTimeout(poll, 3000); }
        else if (wasRunning) onCompleteRef.current();
      } catch {
        if (active) { setError(true); timer = setTimeout(poll, 15000); }
      }
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [itemId, token, revision]);
  async function retryPreparation() {
    if (retrying || job?.recoveryAction !== "retry_preparation") return;
    setRetrying(true); setRetryError("");
    try {
      const result = await api.retryListingPreparation(token, itemId);
      setJob(result.job); setRevision((current) => current + 1);
    } catch (reason) { setRetryError((reason as { error?: string })?.error ?? "Could not restart preparation. Refresh to check its status before trying again."); }
    finally { setRetrying(false); }
  }
  if (error) return <Banner variant="warn" title="Progress is temporarily unavailable" desc="Your listing is saved. Check marketplace activity before starting another publish." />;
  if (!job) return null;
  return <div role="status" aria-live="polite" className="automation-status"><Banner variant={job.status === "FAILED" ? "warn" : "info"} title={job.status === "FAILED" ? "Needs your attention" : job.status === "SUCCEEDED" ? "Automation finished" : "Sello is preparing your listing"} desc={job.message} />{job.recoveryAction === "retry_preparation" && <div className="stack-2"><p>Retry identification checks and pricing. This will not publish your listing.</p><Btn disabled={retrying} onClick={() => void retryPreparation()}>{retrying ? "Starting…" : "Retry preparation"}</Btn></div>}{retryError && <p role="alert">{retryError}</p>}</div>;
}
