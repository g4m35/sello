import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runListingQueue } from "@/lib/automation/listing-job";
import { logUnexpectedError, safeErrorResponse } from "@/lib/errors";
import { pollEbayOrders } from "@/lib/inventory/ebay-order-poller";
import { enqueueStockXStatusChecks } from "@/lib/inventory/stockx-status-monitor";
import { runBulkGenerationQueue } from "@/lib/bulk-intake/jobs";
import { getPrisma } from "@/lib/prisma";
import { run as runSyncJobs } from "@/app/api/inventory/sync-jobs/run/route";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(provided: string | null, expected: string | undefined) {
  if (!expected) return NextResponse.json({ error: "Worker is not configured." }, { status: 503 });
  if (!provided || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function execute() {
  try {
    const started = Date.now();
    const db = getPrisma();
    const failedStages: string[] = [];
    const deferredStages: string[] = [];
    async function stage<T>(name: string, deadline: number, work: () => Promise<T>): Promise<T | null> {
      if (Date.now() >= deadline) { deferredStages.push(name); return null; }
      try { return await work(); }
      catch (error) { logUnexpectedError(`automation_${name}`, error); failedStages.push(name); return null; }
    }
    const drain = async (deadline: number) => {
      const response = await runSyncJobs(new Request("https://internal.invalid", {
        method: "POST", body: JSON.stringify({ limit: 5, requeueStale: true }),
      }), db as never, deadline);
      const result = await response.json();
      if (!response.ok || result.failed || result.failedStale || result.needsReview || result.retryWait) failedStages.push("inventory_sync");
      // Never forward an error body or provider/DB payload from another stage.
      return response.ok ? result : { ok: false };
    };
    // Drain known delists first. A polling or notification failure must never
    // stop this protection or prevent independent accounts/queues progressing.
    const protection = await stage("sale_protection", started + 45_000, () => drain(started + 45_000));
    const sales = await stage("ebay_sales", started + 90_000, () => pollEbayOrders(db, undefined, started + 90_000));
    if (sales?.failed) failedStages.push("ebay_sales");
    const stockx = await stage("stockx_schedule", started + 100_000, () => enqueueStockXStatusChecks(db, undefined, started + 100_000));
    const sync = await stage("inventory_sync", started + 150_000, () => drain(started + 150_000));
    const bulkProcessed = await stage("bulk_preparation", started + 210_000, () => runBulkGenerationQueue(db, started + 210_000));
    const processed = await stage("listing_preparation", started + 250_000, () => runListingQueue(db, started + 250_000));
    return NextResponse.json({ protection, sales, stockx, sync, bulkProcessed, processed,
      failedStages: [...new Set(failedStages)], deferredStages }, { status: failedStages.length ? 503 : 200 });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, { label: "listing_automation_worker" });
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  return authorized(request.headers.get("x-inventory-sync-worker-secret"), process.env.INVENTORY_SYNC_WORKER_SECRET) ?? execute();
}

// Vercel cron authenticates with its own secret. Both entrypoints fail closed.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  return authorized(request.headers.get("authorization"), secret ? `Bearer ${secret}` : undefined) ?? execute();
}
