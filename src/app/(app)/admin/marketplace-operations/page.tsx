"use client";

import { useEffect, useState } from "react";

import {
  AdminMarketplaceOperationsView,
  type FeatureAllowlists,
  type OperationAttempt,
} from "@/components/app/admin-marketplace-operations-view";
import { AdminNav } from "@/components/app/admin-nav";
import { Topbar } from "@/components/app/topbar";
import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api/client";

export default function AdminMarketplaceOperationsPage() {
  const { token } = useSession();
  const [access, setAccess] = useState<FeatureAllowlists | null>(null);
  const [attempts, setAttempts] = useState<OperationAttempt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getAdminMarketplaceOperations(token)
      .then((res) => {
        if (!active) return;
        setAccess(res.access);
        setAttempts(res.attempts);
        // Clear any stale error so a recovered fetch shows real data, not a
        // leftover error/zero state from a previous failed attempt.
        setError(null);
      })
      .catch((e) => active && setError((e as { error?: string })?.error ?? "Not found."))
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <>
      <Topbar crumbs={["Admin", "Marketplace ops"]} />
      <div className="page stack-3">
        <AdminNav active="/admin/marketplace-operations" />
        <AdminMarketplaceOperationsView
          loaded={loaded}
          error={error}
          access={access}
          attempts={attempts}
        />
      </div>
    </>
  );
}
