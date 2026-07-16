import { NextResponse } from "next/server";

import { resolveRuntimeEntitlements } from "@/lib/auth/feature-access";
import { bulkIntakeErrorResponse } from "@/lib/bulk-intake/http";
import { registerBulkPhotos } from "@/lib/bulk-intake/service";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";
import { bulkPhotoRegistrationSchema } from "@/lib/bulk-intake/validation";

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
    const body = bulkPhotoRegistrationSchema.parse(await request.json().catch(() => ({})));
    const batch = await registerBulkPhotos(
      { batchId, account, user, photos: body.photos },
      prisma,
    );
    return NextResponse.json({ batch });
  } catch (error) {
    return bulkIntakeErrorResponse(error, "bulk_photo_register");
  }
}
