import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runListingQueue } from "@/lib/automation/listing-job";
import { safeErrorResponse } from "@/lib/errors";
import { pollEbayOrders } from "@/lib/inventory/ebay-order-poller";
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
    // Sale protection has priority over creating more listings. Call the shared
    // guarded worker locally; never forward credentials to a request-derived URL.
    const sales = await pollEbayOrders(db, undefined, started + 60_000);
    const syncResponse = await runSyncJobs(new Request("https://internal.invalid", {
      method: "POST", body: JSON.stringify({ limit: 5, requeueStale: true }),
    }), db as never);
    const sync = await syncResponse.json();
    const processed = await runListingQueue(db, started + 200_000);
    return NextResponse.json({ sales, sync, processed }, { status: sales.failed || !syncResponse.ok ? 503 : 200 });
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
