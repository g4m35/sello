import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { bulkIntakeErrorResponse } from "@/lib/bulk-intake/http";
import { groupBulkPhotos } from "@/lib/bulk-intake/service";
import { bulkGroupingSchema } from "@/lib/bulk-intake/validation";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { batchId } = await params;
    const body = bulkGroupingSchema.parse(await request.json());
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const batch = await groupBulkPhotos(
      { batchId, account, user, groups: body.groups },
      prisma,
    );
    return NextResponse.json({ batch });
  } catch (error) {
    return bulkIntakeErrorResponse(error, "bulk_grouping_update");
  }
}
