import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));

vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: mocks.getActiveAccount,
}));

vi.mock("server-only", () => ({}));

import { GET } from "./route";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";

function getRequest(marketplace: string | null) {
  const query = marketplace == null ? "" : `?marketplace=${marketplace}`;
  return GET(new Request(`http://localhost/api/listings/${ITEM_ID}/export${query}`), {
    params: Promise.resolve({ id: ITEM_ID }),
  });
}

function draftRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "draft-1",
    status: "APPROVED",
    title: "Supreme Box Logo Hoodie Heather Grey FW17",
    description: "Classic bogo hoodie in heather grey. Worn a handful of times.",
    bulletPoints: ["100% authentic", "FW17 release"],
    recommendedPriceCents: 42000,
    itemSpecifics: { "Pit to Pit": "22 in", Flaws: "Small stain on left cuff" },
    marketplaceDrafts: {
      depop: { title: "x", description: "y", categoryHint: "z", tags: ["supreme", "bogo"] },
    },
    ...overrides,
  };
}

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    productName: "Supreme Box Logo Hoodie",
    brand: "Supreme",
    size: "M",
    colorway: "Heather Grey",
    styleCode: "FW17-BOGO",
    category: "streetwear",
    condition: "used_good",
    recommendedPriceCents: null,
    listingDrafts: [draftRow()],
    ...overrides,
  };
}

function mockItem(row: unknown) {
  mocks.getPrisma.mockReturnValue({
    inventoryItem: { findFirst: vi.fn().mockResolvedValue(row) },
  });
}

describe("listing export API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
  });

  it("returns 401 when the seller is not signed in", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(
      new AppError("Sign in before creating a listing draft.", 401),
    );

    const response = await getRequest("depop");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Sign in before creating a listing draft.",
    });
  });

  it("rejects unsupported marketplace values with 400", async () => {
    mockItem(itemRow());

    const response = await getRequest("ebay");

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(
      /depop, poshmark, grailed, etsy, vinted, or mercari/,
    );
  });

  it("exports an Etsy copy-ready draft with a seller-review advisory", async () => {
    mockItem(itemRow());

    const response = await getRequest("etsy");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.marketplace).toBe("etsy");
    expect(payload.body).toContain("Photo checklist");
    expect(payload.body).toContain("Needs seller review");
    expect(payload.warnings).toContain("Needs seller review for Etsy-specific fields");
  });

  it("rejects a missing marketplace query with 400", async () => {
    mockItem(itemRow());

    const response = await getRequest(null);

    expect(response.status).toBe(400);
  });

  it("returns 404 when the item does not exist", async () => {
    mockItem(null);

    const response = await getRequest("depop");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Item not found" });
  });

  it("scopes lookups to the active account so outsiders' items 404", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    mocks.getPrisma.mockReturnValue({ inventoryItem: { findFirst } });

    const response = await getRequest("grailed");

    expect(response.status).toBe(404);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: ITEM_ID, accountId: "acc-1" }),
      }),
    );
  });

  it("returns the typed export payload for an approved draft", async () => {
    mockItem(itemRow());

    const response = await getRequest("depop");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.marketplace).toBe("depop");
    expect(payload.title).toBe("Supreme Box Logo Hoodie Heather Grey FW17");
    expect(payload.body).toContain("Brand: Supreme");
    expect(payload.body).toContain("Price: $420");
    expect(payload.body).toContain("#supreme");

    const fields = payload.fields as {
      key: string;
      label: string;
      value: string;
    }[];
    expect(fields.map(({ key }) => key)).toEqual([
      "title",
      "description",
      "price",
      "brand",
      "size",
      "condition",
      "color",
      "style_code",
      "tags",
      "category",
    ]);
    expect(fields.find(({ key }) => key === "description")?.value).toBe(
      payload.body,
    );
    expect(fields.find(({ key }) => key === "price")?.value).toBe("$420");
    expect(fields.find(({ key }) => key === "tags")?.value).toBe(
      "#supreme #bogo #streetwear",
    );
    expect(payload.warnings).toEqual([]);
  });

  it("flags an unapproved draft and missing fields in warnings", async () => {
    mockItem(
      itemRow({
        brand: null,
        size: null,
        listingDrafts: [draftRow({ status: "DRAFT", recommendedPriceCents: null })],
      }),
    );

    const response = await getRequest("poshmark");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.warnings).toContain("Missing brand");
    expect(payload.warnings).toContain("Missing size");
    expect(payload.warnings).toContain("Missing price");
    expect(payload.warnings).toContain("Draft has not been approved yet");
  });

  it("uses structured measurements and flaws from the draft when present", async () => {
    mockItem(
      itemRow({
        listingDrafts: [
          draftRow({
            measurements: [
              { label: "Pit to pit", value: "21.5", unit: "in", source: "seller" },
              { label: "Sleeve", value: null, unit: "unknown" },
            ],
            flaws: [
              {
                label: "Cuff stain",
                description: "Light stain on the left cuff",
                severity: "minor",
                source: "ai",
              },
            ],
            itemSpecifics: {},
          }),
        ],
      }),
    );

    const response = await getRequest("grailed");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.body).toContain("Pit to pit: 21.5 in");
    expect(payload.body).not.toContain("[measure]");
    expect(payload.body).toContain("- Cuff stain: Light stain on the left cuff (minor)");
    expect(payload.warnings).toEqual([]);
  });

  it("falls back to itemSpecifics heuristics for drafts without structured fields", async () => {
    mockItem(itemRow());

    const response = await getRequest("poshmark");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.body).toContain("Pit to Pit: 22 in");
    expect(payload.body).toContain("Flaws: Small stain on left cuff");
  });

  it("still exports with warnings when the item has no draft at all", async () => {
    mockItem(itemRow({ listingDrafts: [] }));

    const response = await getRequest("grailed");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.title).toBe("Supreme Box Logo Hoodie");
    expect(payload.warnings).toContain("No listing draft exists for this item yet");
  });
});
