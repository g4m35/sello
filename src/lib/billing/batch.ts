import { isAdminUser } from "@/lib/auth/admin";

import { bulkBatchTooLarge } from "./errors";
import { limitsFor, type PlanId } from "./plans";

// Caps how many items a single bulk action may touch, by plan. Pure (no I/O):
// callers pass the resolved account and the requested item count. Admins are
// never batch-capped.
export function assertBulkBatchSize(
  account: { plan: PlanId },
  count: number,
  user?: { id?: string | null; email?: string | null },
): void {
  if (user && isAdminUser(user)) return;
  const limit = limitsFor(account.plan).bulkBatchSize;
  if (count > limit) throw bulkBatchTooLarge(limit);
}
