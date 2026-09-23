import { NextResponse } from "next/server";
import { getActiveAccount } from "@/lib/billing/account";
import { readAutomationSettings, saveAutomationSettings } from "@/lib/automation/settings";
import { AutomationSettingsInput } from "@/lib/automation/settings-schema";
import { AppError, safeErrorResponse } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const db = getPrisma();
    const account = await getActiveAccount(user.id, db);
    return NextResponse.json(await readAutomationSettings(db, account.id, user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, { label: "automation_settings_get" });
    return NextResponse.json(body, { status });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const db = getPrisma();
    const account = await getActiveAccount(user.id, db);
    let raw: unknown;
    try { raw = await request.json(); } catch { throw new AppError("Enter valid automation settings.", 400, "INVALID_REQUEST"); }
    const input = AutomationSettingsInput.parse(raw);
    return NextResponse.json(await saveAutomationSettings(db, account.id, user.id, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, { label: "automation_settings_put" });
    return NextResponse.json(body, { status });
  }
}
