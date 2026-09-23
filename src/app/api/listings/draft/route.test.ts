import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  snapshotAutomation: vi.fn(),
  after: vi.fn(),
  generateListingDraftWithGemini: vi.fn(),
  getPrisma: vi.fn(),
  prepareListingPhotos: vi.fn(),
  requireSupabaseUser: vi.fn(),
  runCompFetch: vi.fn(),
  uploadListingPhotos: vi.fn(),
  getActiveAccount: vi.fn(),
  resolveRuntimeEntitlements: vi.fn(),
  markUsageReconciliationRequired: vi.fn(),
  markUsageWorkStarted: vi.fn(),
  releaseUsageReservation: vi.fn(),
  reserveUsageOrThrow: vi.fn(),
  settleUsageReservationOrRequireReconciliation: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/ai/gemini", () => ({
  generateListingDraftWithGemini: mocks.generateListingDraftWithGemini,
  GEMINI_PROMPT_VERSION: "test-prompt",
}));
vi.mock("@/lib/comps/fetch", () => ({ runCompFetch: mocks.runCompFetch }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/automation/settings", () => ({ snapshotAutomation: mocks.snapshotAutomation }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/auth/feature-access", () => ({
  resolveRuntimeEntitlements: mocks.resolveRuntimeEntitlements,
}));
vi.mock("@/lib/billing/usage", () => ({
  markUsageReconciliationRequired: mocks.markUsageReconciliationRequired,
  markUsageWorkStarted: mocks.markUsageWorkStarted,
  releaseUsageReservation: mocks.releaseUsageReservation,
  reserveUsageOrThrow: mocks.reserveUsageOrThrow,
  settleUsageReservationOrRequireReconciliation:
    mocks.settleUsageReservationOrRequireReconciliation,
}));
vi.mock("@/lib/storage/listing-photos", () => ({
  prepareListingPhotos: mocks.prepareListingPhotos,
  uploadListingPhotos: mocks.uploadListingPhotos,
}));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));
vi.mock("@/lib/uploads", () => ({ extractListingPhotos: vi.fn(() => []) }));

import { GET, POST } from "./route";
import { PATCH } from "./[draftId]/route";
import { POST as ACTION } from "./[draftId]/route";

describe("listing draft API auth boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.snapshotAutomation.mockResolvedValue({ policy: { mode: "prepare" } });
    mocks.reserveUsageOrThrow.mockResolvedValue({
      reservationId: "usage-reservation-1",
      idempotent: false,
      status: "reserved",
    });
    mocks.releaseUsageReservation.mockResolvedValue(true);
    mocks.markUsageWorkStarted.mockResolvedValue(true);
    mocks.markUsageReconciliationRequired.mockResolvedValue(true);
    mocks.settleUsageReservationOrRequireReconciliation.mockResolvedValue("settled");
    mocks.resolveRuntimeEntitlements.mockResolvedValue({
      account: { id: "acc-1", ownerUserId: "user-1", plan: "free" },
      access: { paidComps: false },
    });
    mocks.requireSupabaseUser.mockRejectedValue(
      new AppError("Sign in before creating a listing draft.", 401),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects draft generation when the seller is not signed in", async () => {
    const response = await POST(new Request("http://localhost/api/listings/draft", { method: "POST" }));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });

  it("rejects latest draft loading when the seller is not signed in", async () => {
    const response = await GET(new Request("http://localhost/api/listings/draft", { method: "GET" }));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });

  it("rejects draft updates when the seller is not signed in", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/listings/draft/draft-id", {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ draftId: "draft-id" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });

  it("rejects draft actions when the seller is not signed in", async () => {
    const response = await ACTION(
      new Request("http://localhost/api/listings/draft/draft-id", {
        method: "POST",
        body: JSON.stringify({ action: "duplicate" }),
      }),
      { params: Promise.resolve({ draftId: "draft-id" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });

  it.each([
    ["allowed@example.com", true],
    ["not-allowed@example.com", false],
  ])(
    "queues durable preparation for %s; worker rechecks provider entitlement",
    async (email, paidProvidersAllowed) => {
      vi.stubEnv("PAID_COMPS_EMAILS", "allowed@example.com");
      mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email });
      mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
      mocks.resolveRuntimeEntitlements.mockResolvedValue({
        account: { id: "acc-1", ownerUserId: "user-1", plan: "free" },
        access: { paidComps: paidProvidersAllowed },
      });
      mocks.prepareListingPhotos.mockResolvedValue([]);
      mocks.uploadListingPhotos.mockResolvedValue([]);
      mocks.generateListingDraftWithGemini.mockResolvedValue({
        model: "gemini-test",
        rawText: "{}",
        rawJson: {},
        draft: {
          identification: {
            productName: "Nike Dunk Low Panda",
            brand: "Nike",
            category: "sneakers",
            condition: "used_good",
            styleCode: "DD1391-100",
            colorway: "Panda",
            size: "10",
            confidence: 0.98,
          },
          listingDraft: {
            title: "Nike Dunk Low Panda Size 10",
            description: "Pre-owned sneakers.",
            bulletPoints: ["Size 10"],
            recommendedPriceCents: null,
            pricingRationale: "Needs real comps.",
            itemSpecifics: {},
            measurements: [],
            flaws: [],
          },
          marketplaceDrafts: {},
          warnings: [],
        },
      });
      const prisma = {
        inventoryItem: {
          create: vi.fn().mockResolvedValue({ id: "item-1" }),
          update: vi.fn().mockResolvedValue({ id: "item-1" }),
        },
        jobLog: { create: vi.fn(async ({ data }) => data) },
        itemPhoto: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
        listingDraft: { create: vi.fn().mockResolvedValue({ id: "draft-1" }) },
        aiOutput: { create: vi.fn().mockResolvedValue({ id: "ai-1" }) },
        $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
      };
      mocks.getPrisma.mockReturnValue(prisma);
      mocks.runCompFetch.mockResolvedValue({ status: "no_comps_found" });

      const response = await POST(
        new Request("http://localhost/api/listings/draft", {
          method: "POST",
          body: new FormData(),
        }),
      );

      expect(response.status).toBe(200);
      expect(prisma.jobLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ payload: expect.objectContaining({ policy: { mode: "prepare" }, accountId: "acc-1", userId: "user-1" }) }) });
      expect(mocks.runCompFetch).not.toHaveBeenCalled();
      expect(mocks.after).toHaveBeenCalledOnce();
    },
  );

  it.each([null, "standing", { mode: "prepare" }, { mode: "publish", marketplace: "ebay", consent: true, minPriceCents: 10000, maxPriceCents: 20000 }])("creates correct defaults and persists per-upload automation: %j", async (automation) => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "u@example.com" });
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
    mocks.prepareListingPhotos.mockResolvedValue([]);
    mocks.uploadListingPhotos.mockResolvedValue([]);
    mocks.generateListingDraftWithGemini.mockResolvedValue({
      model: "gemini-test",
      rawText: "{}",
      rawJson: {},
      draft: {
        identification: {
          productName: "Nike Dunk Low Panda",
          brand: "Nike",
          category: "sneakers",
          condition: "used_good",
          styleCode: "DD1391-100",
          colorway: "Panda",
          size: "10",
          confidence: 0.98,
        },
        listingDraft: {
          title: "Nike Dunk Low Panda Size 10",
          description: "Pre-owned sneakers.",
          bulletPoints: ["Size 10"],
          recommendedPriceCents: null,
          pricingRationale: "Needs real comps.",
          itemSpecifics: {},
          measurements: [],
          flaws: [],
        },
        marketplaceDrafts: {},
        warnings: [],
      },
    });
    const listingDraftCreate = vi.fn().mockResolvedValue({ id: "draft-1" });
    const prisma = {
      inventoryItem: {
        create: vi.fn().mockResolvedValue({ id: "item-1" }),
        update: vi.fn().mockResolvedValue({ id: "item-1" }),
      },
      itemPhoto: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      listingDraft: { create: listingDraftCreate },
      jobLog: { create: vi.fn(async ({ data }) => data) },
      aiOutput: { create: vi.fn().mockResolvedValue({ id: "ai-1" }) },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.runCompFetch.mockResolvedValue({ status: "no_comps_found" });

    const standing = { policy: { mode: "publish", marketplace: "ebay", consent: true, minPriceCents: 1000, maxPriceCents: 50000 }, standingAuthorization: { revision: "00000000-0000-4000-8000-000000000001" } };
    if (automation === "standing") mocks.snapshotAutomation.mockResolvedValue(standing);
    const form = new FormData();
    if (automation && automation !== "standing") form.set("automation", JSON.stringify(automation));
    const response = await POST(
      new Request("http://localhost/api/listings/draft", {
        method: "POST",
        body: form,
      }),
    );

    const data = listingDraftCreate.mock.calls[0][0].data;
    expect(data.marketplaceDrafts.ebay.quantity).toBe(1);
    expect(data.marketplaceDrafts.ebay.categoryId).toBe("15709");
    expect(response.status).toBe(200);
    {
      expect(prisma.jobLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "QUEUED", payload: expect.objectContaining({ accountId: "acc-1", userId: "user-1", policy: automation === "standing" ? standing.policy : automation ?? { mode: "prepare" }, warnings: [] }) }) });
      if (automation === "standing") expect(prisma.jobLog.create.mock.calls[0][0].data.payload.standingAuthorization).toEqual(standing.standingAuthorization);
      expect(mocks.after).toHaveBeenCalledOnce();
      expect(mocks.runCompFetch).not.toHaveBeenCalled();
    }

  });
  it.each([true, false])("allows a fresh retry only after a confirmed pre-write release: %s", async (released) => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    mocks.prepareListingPhotos.mockRejectedValue(new AppError("Invalid photo.", 422));
    mocks.releaseUsageReservation.mockResolvedValue(released);
    mocks.getPrisma.mockReturnValue({ inventoryItem: { update: vi.fn(async () => ({})) }, aiOutput: { create: vi.fn(async () => ({})) } });
    const response = await POST(new Request("http://localhost/api/listings/draft", { method: "POST", body: new FormData() }));
    expect((await response.json()).retrySafe).toBe(released ? true : undefined);
  });

});

describe("listing draft AI quota enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.snapshotAutomation.mockResolvedValue({ policy: { mode: "prepare" } });
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "u@example.com" });
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
    mocks.reserveUsageOrThrow.mockResolvedValue({
      reservationId: "usage-reservation-1",
      idempotent: false,
      status: "reserved",
    });
    mocks.releaseUsageReservation.mockResolvedValue(true);
    mocks.settleUsageReservationOrRequireReconciliation.mockResolvedValue("settled");
  });

  it("returns 402 and does not call Gemini when over the monthly AI-listing quota", async () => {
    mocks.reserveUsageOrThrow.mockRejectedValue(
      new AppError(
        "You have used all of your AI listings for this billing period. Upgrade your plan for more.",
        402,
        "QUOTA_EXCEEDED_AI_LISTING",
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/listings/draft", {
        method: "POST",
        body: new FormData(),
      }),
    );

    expect(response.status).toBe(402);
    expect(mocks.generateListingDraftWithGemini).not.toHaveBeenCalled();
    expect(mocks.settleUsageReservationOrRequireReconciliation).not.toHaveBeenCalled();
  });
});
