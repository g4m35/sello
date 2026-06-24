import { describe, expect, it } from "vitest";

import { buildEtsyDraftBody, type EtsyListingMapInput } from "./mapper";

const base: EtsyListingMapInput = {
  title: "Supreme Box Logo Hoodie Heather Grey FW17",
  description: "Authentic bogo hoodie.",
  priceCents: 42500,
  quantity: 1,
  taxonomyId: "1234",
  shippingProfileId: "5678",
  returnPolicyId: 9012,
  whoMade: "someone_else",
  whenMade: "2010_2019",
  tags: ["supreme", "box logo", "streetwear"],
  materials: ["cotton"],
};

describe("buildEtsyDraftBody", () => {
  it("maps required Etsy fields and converts cents to a major-unit price", () => {
    const body = buildEtsyDraftBody(base);
    expect(body.price).toBe(425);
    expect(body.quantity).toBe(1);
    expect(body.taxonomy_id).toBe(1234);
    expect(body.shipping_profile_id).toBe(5678);
    expect(body.return_policy_id).toBe(9012);
    expect(body.who_made).toBe("someone_else");
    expect(body.when_made).toBe("2010_2019");
    expect(body.type).toBe("physical");
    expect(body.state).toBe("draft");
  });

  it("caps tags at 13 entries of 20 chars and dedupes", () => {
    const body = buildEtsyDraftBody({
      ...base,
      tags: [
        ...Array.from({ length: 20 }, (_, i) => `tag number ${i}`),
        "DUPLICATE",
        "duplicate",
      ],
    });
    const tags = body.tags as string[];
    expect(tags.length).toBeLessThanOrEqual(13);
    for (const tag of tags) expect(tag.length).toBeLessThanOrEqual(20);
  });

  it("omits return_policy_id when not provided", () => {
    const body = buildEtsyDraftBody({ ...base, returnPolicyId: null });
    expect("return_policy_id" in body).toBe(false);
  });

  it("truncates an over-long title to the Etsy limit", () => {
    const body = buildEtsyDraftBody({ ...base, title: "x".repeat(200) });
    expect((body.title as string).length).toBe(140);
  });
});
