import { beforeEach, describe, expect, it, vi } from "vitest";

import { geminiDraftFixture } from "@/test/fixtures/resale";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));

import { POST } from "./[draftId]/route";

function postRequest(action: "reset" | "duplicate") {
  return POST(
    new Request("http://localhost/api/listings/draft/draft-1", {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ draftId: "draft-1" }) },
  );
}

function legacyValidatedJson() {
  // Drafts validated before structured fields existed have no
  // measurements/flaws keys at all.
  const { measurements: _m, flaws: _f, ...listingDraft } = geminiDraftFixture.listingDraft;
  return { ...geminiDraftFixture, listingDraft };
}

function existingDraftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    inventoryItemId: "item-1",
    title: "Nike SB Dunk Low Pro Chicago",
    description: "desc",
    bulletPoints: ["a"],
    recommendedPriceCents: 40000,
    pricingRationale: null,
    itemSpecifics: { Brand: "Nike" },
    marketplaceDrafts: {},
    measurements: null,
    flaws: null,
    selectedMarketplaces: ["ebay"],
    inventoryItem: {
      id: "item-1",
      productName: "Nike SB Dunk Low Pro Chicago",
      aiOutputs: [{ id: "ai-1", validatedJson: legacyValidatedJson() }],
    },
    ...overrides,
  };
}

describe("draft reset/duplicate backward compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
  });

  it("resets from legacy validated AI output without measurements or flaws", async () => {
    const update = vi.fn().mockResolvedValue({ id: "draft-1" });
    mocks.getPrisma.mockReturnValue({
      listingDraft: { findFirst: vi.fn().mockResolvedValue(existingDraftRow()), update },
      inventoryItem: { update: vi.fn().mockResolvedValue({ id: "item-1" }) },
      $transaction: vi.fn(async (ops) => Promise.all(ops)),
    });

    const response = await postRequest("reset");

    expect(response.status).toBe(200);
    const data = update.mock.calls[0][0].data;
    expect(data.measurements).toEqual([]);
    expect(data.flaws).toEqual([]);
  });

  it("stamps AI-origin measurements and flaws with source on reset", async () => {
    const update = vi.fn().mockResolvedValue({ id: "draft-1" });
    const validatedJson = {
      ...geminiDraftFixture,
      listingDraft: {
        ...geminiDraftFixture.listingDraft,
        measurements: [{ label: "Insole length", value: null, unit: "unknown" }],
        flaws: [{ label: "Scuff", description: "Toe box scuff", severity: "minor" }],
      },
    };
    mocks.getPrisma.mockReturnValue({
      listingDraft: {
        findFirst: vi.fn().mockResolvedValue(
          existingDraftRow({
            inventoryItem: {
              id: "item-1",
              productName: "Nike SB Dunk Low Pro Chicago",
              aiOutputs: [{ id: "ai-1", validatedJson }],
            },
          }),
        ),
        update,
      },
      inventoryItem: { update: vi.fn().mockResolvedValue({ id: "item-1" }) },
      $transaction: vi.fn(async (ops) => Promise.all(ops)),
    });

    const response = await postRequest("reset");

    expect(response.status).toBe(200);
    const data = update.mock.calls[0][0].data;
    expect(data.measurements).toEqual([
      { label: "Insole length", value: null, unit: "unknown", source: "ai" },
    ]);
    expect(data.flaws).toEqual([
      { label: "Scuff", description: "Toe box scuff", severity: "minor", source: "ai" },
    ]);
  });

  it("duplicates structured fields and leaves legacy null columns null", async () => {
    const create = vi.fn().mockResolvedValue({ id: "draft-2" });
    const measurements = [
      { label: "Pit to pit", value: "21.5", unit: "in", source: "seller" },
    ];
    mocks.getPrisma.mockReturnValue({
      listingDraft: {
        findFirst: vi
          .fn()
          .mockResolvedValue(existingDraftRow({ measurements, flaws: null })),
        create,
      },
      inventoryItem: { update: vi.fn() },
      $transaction: vi.fn(),
    });

    const response = await postRequest("duplicate");

    expect(response.status).toBe(200);
    const data = create.mock.calls[0][0].data;
    expect(data.measurements).toEqual(measurements);
    expect(data.flaws).toBeUndefined();
  });
});
