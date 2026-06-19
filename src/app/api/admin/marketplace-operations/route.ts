import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/auth/admin";
import { configuredFeatureEmails } from "@/lib/auth/feature-access";
import { AppError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";

type MarketplaceAction = "publish" | "delist" | "cleanup";

function actionFromCode(code: string): MarketplaceAction {
  if (code.startsWith("EBAY_ORPHAN_CLEANUP")) return "cleanup";
  if (code.includes("DELIST")) return "delist";
  return "publish";
}

function bulkRunIdFromAdapterResult(adapterResult: unknown): string | null {
  if (!adapterResult || typeof adapterResult !== "object" || Array.isArray(adapterResult)) {
    return null;
  }
  const value = (adapterResult as Record<string, unknown>).bulkRunId;
  return typeof value === "string" ? value : null;
}

function isMissingTable(error: unknown): boolean {
  const code = error && typeof error === "object" ? (error as { code?: string }).code : undefined;
  return code === "P2021" || code === "42P01";
}

// Owner/admin only, read-only. Surfaces the configured feature allowlists (so an
// admin can confirm who is in each alpha) and recent item-level publish/delist/
// cleanup attempts. Maps ONLY safe fields: no adapter payloads, tokens,
// environment values, raw provider errors, or SKUs ever reach the client.
export async function GET(request: Request) {
  try {
    await requireAdminUser(request);
    const prisma = getPrisma();

    try {
      const attempts = await prisma.publishAttempt.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          code: true,
          status: true,
          requestedBy: true,
          createdAt: true,
          adapterResult: true,
          marketplaceListing: {
            select: {
              externalListingId: true,
              inventoryItem: {
                select: {
                  id: true,
                  productName: true,
                  listingDrafts: {
                    orderBy: { updatedAt: "desc" },
                    take: 1,
                    select: { title: true },
                  },
                },
              },
            },
          },
        },
      });

      const mapped = attempts.map((attempt) => {
        const item = attempt.marketplaceListing.inventoryItem;
        const draftTitle = item.listingDrafts[0]?.title;
        return {
          id: attempt.id,
          requestedBy: attempt.requestedBy,
          itemId: item.id,
          itemTitle: draftTitle || item.productName,
          action: actionFromCode(attempt.code),
          status: attempt.status,
          code: attempt.code,
          bulkRunId: bulkRunIdFromAdapterResult(attempt.adapterResult),
          externalListingId: attempt.marketplaceListing.externalListingId,
          createdAt: attempt.createdAt.toISOString(),
        };
      });

      return NextResponse.json({
        access: configuredFeatureEmails(),
        attempts: mapped,
      });
    } catch (dbError) {
      if (isMissingTable(dbError)) {
        return NextResponse.json(
          {
            error:
              "Publish attempt history is not available yet. Apply the publish persistence migration.",
          },
          { status: 503 },
        );
      }
      throw dbError;
    }
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("admin_marketplace_operations_fetch_failed");
    return NextResponse.json(
      { error: "admin_marketplace_operations_fetch_failed" },
      { status: 500 },
    );
  }
}
