import { isAdminUser } from "@/lib/auth/admin";

import type { PlanId } from "./plans";

type PlanAccount = { plan: PlanId };

export function effectivePlanForUser(
  account: PlanAccount,
  user: { id?: string | null; email?: string | null },
  env: Record<string, string | undefined> = process.env,
): PlanId {
  return isAdminUser(user, env) ? "kingpin" : account.plan;
}

export function accountWithEffectivePlan<T extends PlanAccount>(
  account: T,
  user: { id?: string | null; email?: string | null },
  env: Record<string, string | undefined> = process.env,
): T {
  const plan = effectivePlanForUser(account, user, env);
  return plan === account.plan ? account : { ...account, plan };
}
