import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { summarizeJobLogs } from "@/lib/jobs/summary";
import { listMarketplaceAdapters } from "@/lib/marketplace/adapter";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Read-only job/debug visibility. It never enqueues or runs work; with no
// workers implemented the list is honestly empty rather than faked.
export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const prisma = getPrisma();

    const jobs = await prisma.jobLog.findMany({
      where: { inventoryItem: { sellerId: user.id } },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        queueName: true,
        jobName: true,
        status: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const adapters = listMarketplaceAdapters().map((adapter) => ({
      marketplace: adapter.marketplace,
      displayName: adapter.displayName,
      capabilities: adapter.capabilities,
    }));

    return NextResponse.json({
      jobs,
      summary: summarizeJobLogs(jobs),
      adapters,
      publishingImplemented: false,
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
