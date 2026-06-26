import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { safeErrorResponse, ValidationError } from "@/lib/errors";
import {
  runQueuedSyncJobs,
  type SyncWorkerPrismaLike,
} from "@/lib/inventory-sync/jobs/worker";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";

// Internal-only worker trigger. A trusted scheduler/worker (not the public
// internet) POSTs here to claim + execute a batch of queued SyncJobs. This route:
//   1. fails closed on an internal shared secret (503 if unset, 401 on mismatch);
//   2. claims a bounded batch and runs each via the engine's worker;
//   3. returns ONLY a sanitized summary — never job payloads, errors, or secrets.
// The only live side effect any job can perform is the eBay delist, executed via
// the existing ownership-scoped delist handler. No secrets are logged.

const BodySchema = z
  .object({
    limit: z.number().int().positive().max(25).optional(),
  })
  .strict();

// A JSON syntax error is a malformed request (400), not an internal error (500).
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError("The request body was not valid JSON.");
  }
}

// Timing-safe header compare. Length-guarded so unequal lengths never call
// timingSafeEqual with mismatched buffers.
function secretMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  // Fail closed on the internal secret BEFORE any parsing or DB work.
  const expectedSecret = process.env.INVENTORY_SYNC_WORKER_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: { code: "WORKER_DISABLED", message: "The sync worker is not enabled." } },
      { status: 503 },
    );
  }
  const providedSecret = request.headers.get("x-internal-secret");
  if (!providedSecret || !secretMatches(providedSecret, expectedSecret)) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid internal credentials." } },
      { status: 401 },
    );
  }

  return run(request, getPrisma() as unknown as SyncWorkerPrismaLike);
}

// Separated from POST so tests can drive it with a structural fake without
// stubbing the secret/header gate.
export async function run(request: Request, db: SyncWorkerPrismaLike) {
  try {
    // An empty body is allowed; only a present-but-malformed body is a 400.
    const raw = await request.text();
    const parsed =
      raw.trim() === "" ? {} : BodySchema.parse(parseJson(raw));

    const summary = await runQueuedSyncJobs(db, { limit: parsed.limit });

    // Sanitized summary only — counts, never job payloads/errors/secrets.
    return NextResponse.json({
      ok: true,
      claimed: summary.claimed,
      succeeded: summary.succeeded,
      failed: summary.failed,
      skipped: summary.skipped,
      needsReview: summary.needsReview,
    });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "inventory_sync_jobs_run",
      fallbackCode: "SYNC_WORKER_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
