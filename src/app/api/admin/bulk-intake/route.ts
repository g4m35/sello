import { NextResponse } from "next/server";

import { requireAdminUser } from "@/lib/auth/admin";
import { AppError, logUnexpectedError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";

function isMissingTable(error: unknown): boolean {
  const code = error && typeof error === "object" ? (error as { code?: string }).code : undefined;
  return code === "P2021" || code === "42P01";
}

export async function GET(request: Request) {
  try {
    await requireAdminUser(request);
    const prisma = getPrisma();
    try {
      const rows = await prisma.bulkBatch.findMany({
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true,
          accountId: true,
          createdByUserId: true,
          status: true,
          photoCount: true,
          totalItems: true,
          processedItems: true,
          needsReviewItems: true,
          listingReadyItems: true,
          failedItems: true,
          canceledItems: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      const totals = rows.reduce(
        (sum, row) => ({
          batches: sum.batches + 1,
          active:
            sum.active +
            (row.status === "uploading" ||
            row.status === "processing" ||
            row.status === "needs_review"
              ? 1
              : 0),
          ready: sum.ready + (row.status === "ready" ? 1 : 0),
          failed:
            sum.failed +
            (row.status === "failed" || row.status === "partially_failed" ? 1 : 0),
          items: sum.items + row.totalItems,
        }),
        { batches: 0, active: 0, ready: 0, failed: 0, items: 0 },
      );
      return NextResponse.json({ totals, rows });
    } catch (dbError) {
      if (isMissingTable(dbError)) {
        return NextResponse.json(
          { error: "Bulk intake storage is not available yet. Apply the bulk intake migration." },
          { status: 503 },
        );
      }
      throw dbError;
    }
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logUnexpectedError("admin_bulk_intake_fetch", error);
    return NextResponse.json({ error: "admin_bulk_intake_fetch_failed" }, { status: 500 });
  }
}
