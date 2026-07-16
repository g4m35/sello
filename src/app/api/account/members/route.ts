import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveAccount } from "@/lib/billing/account";
import { accountWithEffectivePlan } from "@/lib/billing/effective-plan";
import {
  assertCanManageAccount,
  inviteMember,
  listMembers,
} from "@/lib/billing/membership";
import { safeErrorResponse } from "@/lib/errors";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const account = await getActiveAccount(user.id);
    return NextResponse.json({ members: await listMembers(account.id) });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "account_members_list",
      fallbackCode: "MEMBERS_LIST_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}

const InviteBody = z.object({
  email: z.email(),
  role: z.enum(["admin", "member"]).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const account = await getActiveAccount(user.id);
    await assertCanManageAccount(account, user.id);
    const { email, role } = InviteBody.parse(await request.json());
    const member = await inviteMember(
      accountWithEffectivePlan(account, user),
      email,
      role ?? "member",
    );
    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "account_members_invite",
      fallbackCode: "MEMBER_INVITE_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
