import { describe, expect, it } from "vitest";

import { GeminiListingDraftSchema } from "@/lib/ai/listing-draft";
import {
  canPublish,
  canTransition,
  toLifecycleState,
} from "@/lib/lifecycle/item-status";
import { evaluateReadiness } from "@/lib/lifecycle/readiness";
import { calculatePricing } from "@/lib/pricing/comps";

import {
  geminiDraftFixture,
  invalidPriceCompFixtures,
  priceCompFixtures,
  readinessInputFromFixture,
} from "./fixtures/resale";

describe("resale fixtures", () => {
  it("the Gemini draft fixture satisfies the live schema", () => {
    expect(() => GeminiListingDraftSchema.parse(geminiDraftFixture)).not.toThrow();
  });
});

describe("draft to ready workflow", () => {
  it("is not ready and needs comps before any pricing or comps exist", () => {
    const readiness = evaluateReadiness(readinessInputFromFixture());
    const pricing = calculatePricing([]);

    expect(readiness.ready).toBe(false);
    expect(readiness.issues.map((i) => i.code)).toContain("missing_price");
    expect(pricing.status).toBe("needs_comps");
  });

  it("derives a price from comps and then becomes ready", () => {
    const pricing = calculatePricing(priceCompFixtures);
    expect(pricing.status).toBe("ready");
    expect(pricing.recommendedListCents).not.toBeNull();

    const readiness = evaluateReadiness(
      readinessInputFromFixture({
        recommendedPriceCents: pricing.recommendedListCents,
      }),
    );

    expect(readiness.ready).toBe(true);
    expect(readiness.issues).toEqual([]);
  });

  it("ignores invalid comps without inventing values", () => {
    const pricing = calculatePricing(invalidPriceCompFixtures);

    expect(pricing.status).toBe("needs_comps");
    expect(pricing.recommendedListCents).toBeNull();
  });
});

describe("lifecycle across the workflow", () => {
  it("moves from draft to ready then sold/delisted, gating publishing", () => {
    expect(toLifecycleState("DRAFT_READY")).toBe("draft");
    expect(canPublish(toLifecycleState("DRAFT_READY"))).toBe(false);

    const ready = toLifecycleState("APPROVED");
    expect(ready).toBe("ready");
    expect(canPublish(ready)).toBe(true);
    expect(canTransition(ready, "sold")).toBe(true);
    expect(canTransition(ready, "delisted")).toBe(true);

    expect(canTransition(toLifecycleState("SOLD"), "ready")).toBe(false);
  });
});
