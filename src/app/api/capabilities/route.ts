import { NextResponse } from "next/server";

import {
  FEATURE_ACCESS_COPY,
  featureAccessForUser,
} from "@/lib/auth/feature-access";
import { getActiveAccount } from "@/lib/billing/account";
import { entitlementsForPlan } from "@/lib/billing/entitlements";
import { AppError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const entitlements = entitlementsForPlan(account.plan);
    return NextResponse.json({
      access: featureAccessForUser(user),
      copy: FEATURE_ACCESS_COPY,
      plan: account.plan,
      limits: entitlements.limits,
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
