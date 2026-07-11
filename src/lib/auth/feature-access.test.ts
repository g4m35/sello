import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AppError } from "@/lib/errors";

import {
  FEATURE_ACCESS_COPY,
  configuredFeatureEmails,
  featureAccessForUser,
  requireFeatureAccess,
  requireRuntimeFeatureAccess,
  resolveRuntimeEntitlements,
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
    ).toMatchObject({
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
    expect(configuredFeatureEmails({})).toMatchObject({
      liveEbayPublish: [],
      ebayDelist: [],
      paidComps: [],
      etsyConnect: [],
      etsyPublish: [],
      etsyDelist: [],
      etsyOrders: [],
    });
  });

  it("does not fall back to ADMIN_EMAILS for any feature allowlist", () => {
    expect(
      configuredFeatureEmails({ ADMIN_EMAILS: "owner@sello.com" }),
    ).toMatchObject({ liveEbayPublish: [], ebayDelist: [], paidComps: [] });
  });
});

describe("featureAccessForUser", () => {
  it("grants each feature independently for non-admins", () => {
    expect(
      featureAccessForUser(
        { email: "seller@example.com" },
        {
          ADMIN_EMAILS: "owner@example.com",
          LIVE_EBAY_PUBLISH_EMAILS: "",
          EBAY_DELIST_EMAILS: "seller@example.com",
          PAID_COMPS_EMAILS: "beta@example.com, SELLER@example.com",
        },
      ),
    ).toMatchObject({
      liveEbayPublish: false,
      ebayDelist: true,
      paidComps: true,
    });
  });

  it("grants every entitlement to ADMIN_EMAILS users for owner testing", () => {
    expect(
      featureAccessForUser(
        { email: "owner@example.com" },
        {
          ADMIN_EMAILS: "owner@example.com",
          LIVE_EBAY_PUBLISH_EMAILS: "",
          EBAY_DELIST_EMAILS: "",
          PAID_COMPS_EMAILS: "",
        },
      ),
    ).toMatchObject({
      liveEbayPublish: true,
      ebayDelist: true,
      paidComps: true,
      etsyConnect: true,
      etsyPublish: true,
      etsyDelist: true,
      etsyOrders: true,
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
    ).toMatchObject({
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
      ).toMatchObject({
        liveEbayPublish: false,
        ebayDelist: false,
        paidComps: false,
        etsyConnect: false,
        etsyPublish: false,
        etsyDelist: false,
        etsyOrders: false,
      });
    },
  );

  it("still fails closed for non-admins when only ADMIN_EMAILS is set", () => {
    expect(
      featureAccessForUser(
        { email: "seller@example.com" },
        { ADMIN_EMAILS: "owner@example.com" },
      ),
    ).toMatchObject({
      liveEbayPublish: false,
      ebayDelist: false,
      paidComps: false,
      etsyConnect: false,
      etsyPublish: false,
      etsyDelist: false,
      etsyOrders: false,
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
    { entitlement: "etsyConnect", code: "ETSY_CONNECT_ALPHA_ONLY" },
    { entitlement: "etsyPublish", code: "ETSY_PUBLISH_ALPHA_ONLY" },
    { entitlement: "etsyDelist", code: "ETSY_DELIST_ALPHA_ONLY" },
    { entitlement: "etsyOrders", code: "ETSY_ORDERS_ALPHA_ONLY" },
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
    const envKey: Record<FeatureEntitlement, string> = {
      liveEbayPublish: "LIVE_EBAY_PUBLISH_EMAILS",
      ebayDelist: "EBAY_DELIST_EMAILS",
      paidComps: "PAID_COMPS_EMAILS",
      etsyConnect: "ETSY_CONNECT_EMAILS",
      etsyPublish: "ETSY_PUBLISH_EMAILS",
      etsyDelist: "ETSY_DELIST_EMAILS",
      etsyOrders: "ETSY_ORDERS_EMAILS",
    };
    const resolvedKey = envKey[entitlement];

    expect(() =>
      requireFeatureAccess(
        { email: "seller@example.com" },
        entitlement,
        { [resolvedKey]: "seller@example.com" },
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
      etsyConnect:
        "Connecting an Etsy shop is currently enabled for selected alpha accounts.",
      etsyPublish:
        "Live Etsy publishing is currently enabled for selected alpha accounts.",
      etsyDelist:
        "Live Etsy delisting is currently enabled for selected alpha accounts.",
      etsyOrders:
        "Etsy order sync is currently enabled for selected alpha accounts.",
    });

    const serialized = JSON.stringify(FEATURE_ACCESS_COPY).toLowerCase();
    expect(serialized).not.toContain("emails");
    expect(serialized).not.toContain("admin");
    expect(serialized).not.toContain("@");
  });
});

function runtimePrisma(opts: {
  plan?: "free" | "pro" | "kingpin";
  disabledAt?: Date | null;
  subscriptionStatus?: "active" | "trialing" | "past_due" | null;
  graceEndsAt?: Date | null;
} = {}) {
  return {
    account: {
      findUnique: vi.fn().mockResolvedValue({
        id: "acc-1",
        ownerUserId: "user-1",
        plan: opts.plan ?? "free",
        disabledAt: opts.disabledAt ?? null,
      }),
    },
    accountMember: { findFirst: vi.fn() },
    subscription: {
      findUnique: vi.fn().mockResolvedValue(
        opts.subscriptionStatus === undefined
          ? null
          : {
              status: opts.subscriptionStatus,
              graceEndsAt: opts.graceEndsAt ?? null,
            },
      ),
    },
  } as never;
}

const paidCompsEnv = {
  PAID_COMPS_EMAILS: "seller@example.com",
  COMPS_PAID_PROVIDERS_ENABLED: "true",
  COMPS_APIFY_EBAY_SOLD_ENABLED: "true",
  APIFY_TOKEN: "configured-test-placeholder",
};

describe("authoritative runtime entitlements", () => {
  it("uses one account, subscription, switch, provider, and allowlist decision", async () => {
    const resolved = await resolveRuntimeEntitlements(
      { id: "user-1", email: "seller@example.com" },
      runtimePrisma(),
      paidCompsEnv,
    );

    expect(resolved.account.id).toBe("acc-1");
    expect(resolved.access.paidComps).toBe(true);
    expect(resolved.decisions.paidComps.reason).toBe("ALLOWED");
  });

  it("fails closed on the runtime switch even for an allowlisted seller", async () => {
    const resolved = await resolveRuntimeEntitlements(
      { id: "user-1", email: "seller@example.com" },
      runtimePrisma(),
      { ...paidCompsEnv, COMPS_PAID_PROVIDERS_ENABLED: "false" },
    );

    expect(resolved.decisions.paidComps).toMatchObject({
      allowed: false,
      reason: "FEATURE_KILL_SWITCH_ACTIVE",
    });
  });

  it("enforces paid-plan subscription state and honors a bounded grace period", async () => {
    const inactive = await resolveRuntimeEntitlements(
      { id: "user-1", email: "seller@example.com" },
      runtimePrisma({ plan: "pro", subscriptionStatus: "past_due" }),
      paidCompsEnv,
      new Date("2026-07-11T12:00:00Z"),
    );
    expect(inactive.decisions.paidComps.reason).toBe("SUBSCRIPTION_INACTIVE");

    const grace = await resolveRuntimeEntitlements(
      { id: "user-1", email: "seller@example.com" },
      runtimePrisma({
        plan: "pro",
        subscriptionStatus: "past_due",
        graceEndsAt: new Date("2026-07-12T12:00:00Z"),
      }),
      paidCompsEnv,
      new Date("2026-07-11T12:00:00Z"),
    );
    expect(grace.decisions.paidComps).toMatchObject({
      allowed: true,
      gracePeriodActive: true,
    });
  });

  it("rejects a disabled active account before evaluating commercial access", async () => {
    await expect(
      requireRuntimeFeatureAccess(
        { id: "user-1", email: "seller@example.com" },
        "paidComps",
        runtimePrisma({ disabledAt: new Date("2026-07-11T00:00:00Z") }),
        paidCompsEnv,
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_DISABLED", status: 403 });
  });

  it("does not let an admin bypass a disabled runtime switch", async () => {
    const resolved = await resolveRuntimeEntitlements(
      { id: "user-1", email: "owner@example.com" },
      runtimePrisma(),
      {
        ...paidCompsEnv,
        ADMIN_EMAILS: "owner@example.com",
        COMPS_PAID_PROVIDERS_ENABLED: "false",
      },
    );
    expect(resolved.decisions.paidComps.reason).toBe("FEATURE_KILL_SWITCH_ACTIVE");
  });
});
