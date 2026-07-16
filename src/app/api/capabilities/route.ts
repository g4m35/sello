import { NextResponse } from "next/server";

import {
  FEATURE_ACCESS_COPY,
  resolveRuntimeEntitlements,
} from "@/lib/auth/feature-access";
import { AppError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const prisma = getPrisma();
    const resolved = await resolveRuntimeEntitlements(user, prisma);
    return NextResponse.json({
      access: resolved.access,
      copy: FEATURE_ACCESS_COPY,
      plan: resolved.plan,
      limits: resolved.limits,
      features: resolved.features,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("capabilities_fetch_failed");
    return NextResponse.json(
      { error: "capabilities_fetch_failed" },
      { status: 500 },
    );
  }
}
