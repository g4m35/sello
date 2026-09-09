"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { Banner } from "@/components/ui/primitives";

export function ListingAutomationStatus({ itemId, token, onComplete }: { itemId: string; token: string; onComplete: () => void }) {
  const [job, setJob] = useState<{ status: string; message: string } | null>(null);
  const [error, setError] = useState(false);
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
  }, [itemId, token]);
  if (error) return <Banner variant="warn" title="Progress is temporarily unavailable" desc="Your listing is saved. Check marketplace activity before starting another publish." />;
  if (!job) return null;
  return <div role="status" aria-live="polite" className="automation-status"><Banner variant={job.status === "FAILED" ? "warn" : "info"} title={job.status === "FAILED" ? "Needs your attention" : job.status === "SUCCEEDED" ? "Automation finished" : "Sello is preparing your listing"} desc={job.message} /></div>;
}
