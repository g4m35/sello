import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  generateListingDraftWithGemini: vi.fn(),
  getPrisma: vi.fn(),
  prepareListingPhotos: vi.fn(),
  requireSupabaseUser: vi.fn(),
  runCompFetch: vi.fn(),
  uploadListingPhotos: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/gemini", () => ({
  generateListingDraftWithGemini: mocks.generateListingDraftWithGemini,
  GEMINI_PROMPT_VERSION: "test-prompt",
}));
vi.mock("@/lib/comps/fetch", () => ({ runCompFetch: mocks.runCompFetch }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
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
        { paidProvidersAllowed },
      );
    },
  );
});
