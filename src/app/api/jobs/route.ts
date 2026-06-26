import { NextResponse } from "next/server";

import { featureAccessForUser } from "@/lib/auth/feature-access";
import { getActiveAccount } from "@/lib/billing/account";
import { inventoryChildScope } from "@/lib/billing/scope";
import { AppError, safeClientMessage } from "@/lib/errors";
import { summarizeJobLogs } from "@/lib/jobs/summary";
import { listMarketplaceAdapters } from "@/lib/marketplace/adapter";
import { isEbayProductionPublishEnabled } from "@/lib/marketplace/adapters/ebay/config";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Read-only job/debug visibility. It never enqueues or runs work; with no
// workers implemented the list is honestly empty rather than faked.
export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);

    const jobs = await prisma.jobLog.findMany({
      where: inventoryChildScope(account),
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

    // eBay live publishing is real, but gated: it requires the global
    // production publish flag AND this seller's live-publish entitlement.
    // Inventory sync has no implementation, so it stays false everywhere.
    const ebayLivePublishEnabled =
      isEbayProductionPublishEnabled() && featureAccessForUser(user).liveEbayPublish;

    const adapters = listMarketplaceAdapters().map((adapter) => ({
      marketplace: adapter.marketplace,
      displayName: adapter.displayName,
      capabilities: {
        ...adapter.capabilities,
        publish:
          adapter.marketplace === "ebay"
            ? ebayLivePublishEnabled
            : adapter.capabilities.publish,
      },
    }));

    return NextResponse.json({
      jobs,
      summary: summarizeJobLogs(jobs),
      adapters,
      publishingImplemented: ebayLivePublishEnabled,
      ebayLivePublishEnabled,
      inventorySyncAvailable: false,
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json(
      { error: safeClientMessage(error, { label: "jobs_list" }) },
      { status },
    );
  }
}
