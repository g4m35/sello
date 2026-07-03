import { NextResponse } from "next/server";

import { featureAccessForUser } from "@/lib/auth/feature-access";
import { getActiveAccount } from "@/lib/billing/account";
import { inventoryChildScope } from "@/lib/billing/scope";
import { AppError, safeClientMessage } from "@/lib/errors";
import { summarizeJobLogs } from "@/lib/jobs/summary";
import { listMarketplaceAdapters } from "@/lib/marketplace/adapter";
import { isEbayProductionPublishEnabled } from "@/lib/marketplace/adapters/ebay/config";
import { isStockXListingCreationAvailable } from "@/lib/marketplace/adapters/stockx/capabilities";
import { isStockXApiConfigured } from "@/lib/marketplace/adapters/stockx/config";
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

    // eBay live publishing is gated by the global production flag plus this
    // seller's entitlement. StockX listing/deactivation run through dedicated
    // handlers, so expose their real API readiness instead of the legacy
    // compatibility adapter's draft-only defaults.
    const ebayLivePublishEnabled =
      isEbayProductionPublishEnabled() && featureAccessForUser(user).liveEbayPublish;
    const stockxApiConfigured = isStockXApiConfigured();
    const stockxListingEnabled = isStockXListingCreationAvailable();

    const adapters = listMarketplaceAdapters().map((adapter) => ({
      marketplace: adapter.marketplace,
      displayName: adapter.displayName,
      capabilities: {
        ...adapter.capabilities,
        publish:
          adapter.marketplace === "ebay"
            ? ebayLivePublishEnabled
            : adapter.marketplace === "stockx"
              ? stockxListingEnabled
              : adapter.capabilities.publish,
        inventorySync:
          adapter.marketplace === "stockx"
            ? stockxApiConfigured
            : adapter.capabilities.inventorySync,
        delist: adapter.marketplace === "stockx" ? stockxApiConfigured : false,
      },
    }));

    return NextResponse.json({
      jobs,
      summary: summarizeJobLogs(jobs),
      adapters,
      publishingImplemented: ebayLivePublishEnabled || stockxListingEnabled,
      ebayLivePublishEnabled,
      stockxListingEnabled,
      stockxDelistEnabled: stockxApiConfigured,
      inventorySyncAvailable: stockxApiConfigured,
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json(
      { error: safeClientMessage(error, { label: "jobs_list" }) },
      { status },
    );
  }
}
