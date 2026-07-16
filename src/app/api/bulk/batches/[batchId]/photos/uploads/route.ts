import { NextResponse } from "next/server";

import { resolveRuntimeEntitlements } from "@/lib/auth/feature-access";
import { bulkIntakeErrorResponse } from "@/lib/bulk-intake/http";
import { createBulkPhotoUploadGrants } from "@/lib/bulk-intake/service";
import { bulkPhotoUploadRequestSchema } from "@/lib/bulk-intake/validation";
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
    const body = bulkPhotoUploadRequestSchema.parse(await request.json().catch(() => ({})));
    const prisma = getPrisma();
    const resolved = await resolveRuntimeEntitlements(user, prisma);
    const account = { ...resolved.account, plan: resolved.plan };
    const uploads = await createBulkPhotoUploadGrants(
      { batchId, account, user, photos: body.photos },
      prisma,
    );
    return NextResponse.json({ uploads });
  } catch (error) {
    return bulkIntakeErrorResponse(error, "bulk_photo_upload_sign");
  }
}
