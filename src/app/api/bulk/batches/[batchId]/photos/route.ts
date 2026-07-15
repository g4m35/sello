import { NextResponse } from "next/server";

import { resolveRuntimeEntitlements } from "@/lib/auth/feature-access";
import { bulkIntakeErrorResponse } from "@/lib/bulk-intake/http";
import { registerBulkPhotos } from "@/lib/bulk-intake/service";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { batchId } = await params;
    const prisma = getPrisma();
    const resolved = await resolveRuntimeEntitlements(user, prisma);
    const account = { ...resolved.account, plan: resolved.plan };
    const batch = await registerBulkPhotos(
      { batchId, account, user, formData: await request.formData() },
      prisma,
    );
    return NextResponse.json({ batch });
  } catch (error) {
    return bulkIntakeErrorResponse(error, "bulk_photo_register");
  }
}
