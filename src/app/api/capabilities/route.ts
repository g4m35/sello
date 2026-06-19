import { NextResponse } from "next/server";

import {
  FEATURE_ACCESS_COPY,
  featureAccessForUser,
} from "@/lib/auth/feature-access";
import { AppError } from "@/lib/errors";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    return NextResponse.json({
      access: featureAccessForUser(user),
      copy: FEATURE_ACCESS_COPY,
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
