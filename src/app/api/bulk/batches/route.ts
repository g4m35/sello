import { NextResponse } from "next/server";

import { resolveRuntimeEntitlements } from "@/lib/auth/feature-access";
import { getActiveAccount } from "@/lib/billing/account";
import { bulkIntakeErrorResponse } from "@/lib/bulk-intake/http";
import { createBulkBatch, listBulkBatches } from "@/lib/bulk-intake/service";
import { createBulkBatchSchema } from "@/lib/bulk-intake/validation";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const prisma = getPrisma();
    const resolved = await resolveRuntimeEntitlements(user, prisma);
    const account = { ...resolved.account, plan: resolved.plan };
    return NextResponse.json({ batches: await listBulkBatches(account.id, prisma) });
  } catch (error) {
    return bulkIntakeErrorResponse(error, "bulk_batch_list");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const body = createBulkBatchSchema.parse(await request.json().catch(() => ({})));
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const batch = await createBulkBatch(
      {
        account,
        user,
        idempotencyKey: body.idempotencyKey,
        expectedItems: body.expectedItems,
      },
      prisma,
    );
    return NextResponse.json({ batch }, { status: 201 });
  } catch (error) {
    return bulkIntakeErrorResponse(error, "bulk_batch_create");
  }
}
