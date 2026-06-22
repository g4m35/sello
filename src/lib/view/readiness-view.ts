import {
  evaluateDraftReadiness,
  type DraftReadinessInput,
} from "@/lib/listing/draft-readiness";
import type { ReadinessView } from "@/lib/view/types";

export type ReadinessViewInput = DraftReadinessInput;

/**
 * Builds the readiness checklist for the UI from the single server-side
 * readiness evaluator. The same evaluation gates the approve action and is a
 * strict subset of the eBay publish preflight, so the UI's "ready/blocked"
 * state always matches what publishing will actually allow. Photo count is an
 * informational warn below three but still blocks at zero (eBay needs a photo).
 */
export function buildReadinessView(input: ReadinessViewInput): ReadinessView {
  const { ready, checks } = evaluateDraftReadiness(input);
  const totalCount = checks.length;
  const doneCount = checks.filter((c) => c.state === "done").length;
  const pct = totalCount === 0 ? 100 : Math.round((doneCount / totalCount) * 100);
  return { ready, pct, doneCount, totalCount, checks };
}
