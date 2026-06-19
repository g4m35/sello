import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AppError } from "@/lib/errors";

import {
  FEATURE_ACCESS_COPY,
  configuredFeatureEmails,
  featureAccessForUser,
  requireFeatureAccess,
  type FeatureEntitlement,
} from "./feature-access";

describe("configuredFeatureEmails", () => {
  it("parses comma-separated emails case-insensitively and removes whitespace and duplicates", () => {
    expect(
      configuredFeatureEmails({
        LIVE_EBAY_PUBLISH_EMAILS:
          " Owner@Example.com, beta@example.com, owner@example.COM, , BETA@example.com ",
        EBAY_DELIST_EMAILS: " seller@example.com ",
        PAID_COMPS_EMAILS: undefined,
      }),
    ).toEqual({
      liveEbayPublish: ["owner@example.com", "beta@example.com"],
      ebayDelist: ["seller@example.com"],
      paidComps: [],
    });
  });

  it("reports a count of 1 when a single owner email is configured per feature", () => {
    const configured = configuredFeatureEmails({
      LIVE_EBAY_PUBLISH_EMAILS: "owner@sello.com",
      EBAY_DELIST_EMAILS: "owner@sello.com",
      PAID_COMPS_EMAILS: "owner@sello.com",
    });
    expect(configured.liveEbayPublish).toHaveLength(1);
    expect(configured.ebayDelist).toHaveLength(1);
    expect(configured.paidComps).toHaveLength(1);
    expect(configured.paidComps).toEqual(["owner@sello.com"]);
  });

  it("fails closed when feature allowlist variables are missing", () => {
    expect(configuredFeatureEmails({})).toEqual({
      liveEbayPublish: [],
      ebayDelist: [],
      paidComps: [],
    });
  });

  it("does not fall back to ADMIN_EMAILS for any feature allowlist", () => {
    expect(
      configuredFeatureEmails({ ADMIN_EMAILS: "owner@sello.com" }),
    ).toEqual({ liveEbayPublish: [], ebayDelist: [], paidComps: [] });
  });
});

describe("featureAccessForUser", () => {
  it("grants each feature independently without falling back to ADMIN_EMAILS", () => {
    expect(
      featureAccessForUser(
        { email: "owner@example.com" },
        {
          ADMIN_EMAILS: "owner@example.com",
          LIVE_EBAY_PUBLISH_EMAILS: "",
          EBAY_DELIST_EMAILS: "owner@example.com",
          PAID_COMPS_EMAILS: "beta@example.com, OWNER@example.com",
        },
      ),
    ).toEqual({
      liveEbayPublish: false,
      ebayDelist: true,
      paidComps: true,
    });
  });

  it("matches the signed-in email case-insensitively", () => {
    expect(
      featureAccessForUser(
        { email: "  OWNER@EXAMPLE.COM " },
        {
          LIVE_EBAY_PUBLISH_EMAILS: "owner@example.com",
          EBAY_DELIST_EMAILS: "OWNER@example.com",
          PAID_COMPS_EMAILS: "Owner@Example.Com",
        },
      ),
    ).toEqual({
      liveEbayPublish: true,
      ebayDelist: true,
      paidComps: true,
    });
  });

  it.each([{ email: undefined }, { email: null }, { email: "" }])(
    "fails closed when the user email is $email",
    (user) => {
      expect(
        featureAccessForUser(user, {
          LIVE_EBAY_PUBLISH_EMAILS: "owner@example.com",
          EBAY_DELIST_EMAILS: "owner@example.com",
          PAID_COMPS_EMAILS: "owner@example.com",
        }),
      ).toEqual({
        liveEbayPublish: false,
        ebayDelist: false,
        paidComps: false,
      });
    },
  );

  it("does not grant any feature from ADMIN_EMAILS alone", () => {
    expect(
      featureAccessForUser(
        { email: "owner@example.com" },
        { ADMIN_EMAILS: "owner@example.com" },
      ),
    ).toEqual({
      liveEbayPublish: false,
      ebayDelist: false,
      paidComps: false,
    });
  });
});

describe("requireFeatureAccess", () => {
  const cases: Array<{
    entitlement: FeatureEntitlement;
    code: string;
  }> = [
    {
      entitlement: "liveEbayPublish",
      code: "LIVE_EBAY_PUBLISH_ALPHA_ONLY",
    },
    { entitlement: "ebayDelist", code: "EBAY_DELIST_ALPHA_ONLY" },
    { entitlement: "paidComps", code: "PAID_COMPS_ALPHA_ONLY" },
  ];

  it.each(cases)(
    "throws the stable $code denial for $entitlement",
    ({ entitlement, code }) => {
      let thrown: unknown;

      try {
        requireFeatureAccess(
          { email: "seller@example.com" },
          entitlement,
          {},
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(AppError);
      expect(thrown).toMatchObject({
        message: FEATURE_ACCESS_COPY[entitlement],
        status: 403,
        code,
      });
    },
  );

  it.each(cases)("allows an independently entitled $entitlement user", ({ entitlement }) => {
    const envKey = {
      liveEbayPublish: "LIVE_EBAY_PUBLISH_EMAILS",
      ebayDelist: "EBAY_DELIST_EMAILS",
      paidComps: "PAID_COMPS_EMAILS",
    }[entitlement];

    expect(() =>
      requireFeatureAccess(
        { email: "seller@example.com" },
        entitlement,
        { [envKey]: "seller@example.com" },
      ),
    ).not.toThrow();
  });
});

describe("FEATURE_ACCESS_COPY", () => {
  it("contains only stable seller-safe alpha messaging", () => {
    expect(FEATURE_ACCESS_COPY).toEqual({
      liveEbayPublish:
        "Live eBay publishing is currently enabled for selected alpha accounts.",
      ebayDelist:
        "Live eBay delisting is currently enabled for selected alpha accounts.",
      paidComps:
        "Fresh sold comps are currently enabled for selected alpha accounts.",
    });

    const serialized = JSON.stringify(FEATURE_ACCESS_COPY).toLowerCase();
    expect(serialized).not.toContain("emails");
    expect(serialized).not.toContain("admin");
    expect(serialized).not.toContain("@");
  });
});
