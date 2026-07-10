import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  generateListingDraftWithGemini: vi.fn(),
  getPrisma: vi.fn(),
  prepareListingPhotos: vi.fn(),
  requireSupabaseUser: vi.fn(),
  runCompFetch: vi.fn(),
  uploadListingPhotos: vi.fn(),
  getActiveAccount: vi.fn(),
  assertWithinQuota: vi.fn(),
  incrementUsage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/gemini", () => ({
  generateListingDraftWithGemini: mocks.generateListingDraftWithGemini,
  GEMINI_PROMPT_VERSION: "test-prompt",
}));
vi.mock("@/lib/comps/fetch", () => ({ runCompFetch: mocks.runCompFetch }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/billing/usage", () => ({
  assertWithinQuota: mocks.assertWithinQuota,
  incrementUsage: mocks.incrementUsage,
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
    "passes paidProvidersAllowed=%s entitlement into draft auto-discovery",
    async (email, paidProvidersAllowed) => {
      vi.stubEnv("PAID_COMPS_EMAILS", "allowed@example.com");
      mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email });
      mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
      mocks.assertWithinQuota.mockResolvedValue(undefined);
      mocks.incrementUsage.mockResolvedValue(undefined);
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
        },
      });
      const prisma = {
        inventoryItem: {
          create: vi.fn().mockResolvedValue({ id: "item-1" }),
          update: vi.fn().mockResolvedValue({ id: "item-1" }),
        },
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
      expect(mocks.runCompFetch).toHaveBeenCalledWith(
        prisma,
        expect.any(String),
        "user-1",
        { paidProvidersAllowed, adminOverride: false },
      );
    },
  );

  it("defaults quantity to 1 and infers a high-confidence eBay category on the new draft", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "u@example.com" });
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
    mocks.assertWithinQuota.mockResolvedValue(undefined);
    mocks.incrementUsage.mockResolvedValue(undefined);
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
      aiOutput: { create: vi.fn().mockResolvedValue({ id: "ai-1" }) },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.runCompFetch.mockResolvedValue({ status: "no_comps_found" });

    await POST(
      new Request("http://localhost/api/listings/draft", {
        method: "POST",
        body: new FormData(),
      }),
    );

    const data = listingDraftCreate.mock.calls[0][0].data;
    expect(data.marketplaceDrafts.ebay.quantity).toBe(1);
    expect(data.marketplaceDrafts.ebay.categoryId).toBe("15709");
  });
});

describe("listing draft AI quota enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "u@example.com" });
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
  });

  it("returns 402 and does not call Gemini when over the monthly AI-listing quota", async () => {
    mocks.assertWithinQuota.mockRejectedValue(
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
    expect(mocks.incrementUsage).not.toHaveBeenCalled();
  });
});
