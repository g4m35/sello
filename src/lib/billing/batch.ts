import { bulkBatchTooLarge } from "./errors";
import { limitsFor, type PlanId } from "./plans";

// Caps how many items a single bulk action may touch, by plan. Pure (no I/O):
// callers pass the resolved account and the requested item count.
export function assertBulkBatchSize(account: { plan: PlanId }, count: number): void {
  const limit = limitsFor(account.plan).bulkBatchSize;
  if (count > limit) throw bulkBatchTooLarge(limit);
}
