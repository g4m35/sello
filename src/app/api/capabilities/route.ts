import { NextResponse } from "next/server";

import {
  FEATURE_ACCESS_COPY,
  featureAccessForUser,
} from "@/lib/auth/feature-access";
import { getActiveAccount } from "@/lib/billing/account";
import {
  effectiveFeaturesForUser,
  effectiveLimitsForUser,
  effectivePlanForUser,
} from "@/lib/billing/effective-plan";
import { AppError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const plan = effectivePlanForUser(account, user);
    return NextResponse.json({
      access: featureAccessForUser(user),
      copy: FEATURE_ACCESS_COPY,
      plan,
      limits: effectiveLimitsForUser(account, user),
      features: effectiveFeaturesForUser(account, user),
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
