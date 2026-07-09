import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { revokeMember } from "@/lib/billing/membership";
import { safeErrorResponse } from "@/lib/errors";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const account = await getActiveAccount(user.id);
    const { id } = await params;
    await revokeMember(account, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "account_members_revoke",
      fallbackCode: "MEMBER_REVOKE_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
