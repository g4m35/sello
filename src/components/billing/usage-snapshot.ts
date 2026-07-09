"use client";

import { readJsonResponse } from "@/lib/http";
import type { PlanId } from "@/lib/billing/plans";

export interface UsageSnapshot {
  plan: PlanId;
  limits: {
    aiListingsPerMonth: number;
    autopublishesPerMonth: number;
    compRefreshesPerMonth: number;
  };
  usage: { ai_listing: number; autopublish: number; comp_refresh: number };
  periodEnd: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
}

export const BILLING_USAGE_CACHE_TTL_MS = 30_000;

type CacheEntry = {
  token: string;
  snapshot: UsageSnapshot;
  fetchedAt: number;
};

let cachedUsage: CacheEntry | null = null;
let inFlightUsage: { token: string; promise: Promise<UsageSnapshot> } | null = null;

export function getCachedBillingUsage(token: string, now = Date.now()): UsageSnapshot | null {
  if (!cachedUsage || cachedUsage.token !== token) return null;
  if (now - cachedUsage.fetchedAt > BILLING_USAGE_CACHE_TTL_MS) return null;
  return cachedUsage.snapshot;
}

export async function fetchBillingUsage(
  token: string,
  options: { force?: boolean } = {},
): Promise<UsageSnapshot> {
  const cached = options.force ? null : getCachedBillingUsage(token);
  if (cached) return cached;
  if (!options.force && inFlightUsage?.token === token) return inFlightUsage.promise;

  const promise = readJsonResponse<UsageSnapshot>(
    await fetch("/api/billing/usage", {
      headers: { Authorization: `Bearer ${token}` },
    }),
  ).then((snapshot) => {
    cachedUsage = { token, snapshot, fetchedAt: Date.now() };
    return snapshot;
  });

  inFlightUsage = { token, promise };
  try {
    return await promise;
  } finally {
    if (inFlightUsage?.promise === promise) inFlightUsage = null;
  }
}

export function prefetchBillingUsage(token: string): void {
  void fetchBillingUsage(token).catch(() => undefined);
}

export function clearBillingUsageCache(): void {
  cachedUsage = null;
  inFlightUsage = null;
}
