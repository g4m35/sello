import { describe, expect, it } from "vitest";

import {
  conditionLabel,
  categoryLabel,
  estPayoutCents,
  formatMoneyCents,
  relativeTime,
  splitTitle,
} from "@/lib/view/format";
import { buildReadinessView } from "@/lib/view/readiness-view";

describe("formatMoneyCents", () => {
  it("formats whole dollars without decimals", () => {
    expect(formatMoneyCents(42500)).toBe("$425");
  });
  it("formats partial dollars with two decimals", () => {
    expect(formatMoneyCents(1450)).toBe("$14.50");
  });
  it("renders an em-dash-free placeholder for null", () => {
    expect(formatMoneyCents(null)).toBe("—");
  });
});

describe("estPayoutCents", () => {
  it("returns 90% of price", () => {
    expect(estPayoutCents(10000)).toBe(9000);
  });
  it("passes through null", () => {
    expect(estPayoutCents(null)).toBeNull();
  });
});

describe("labels", () => {
  it("maps known condition enums", () => {
    expect(conditionLabel("used_excellent")).toBe("Used — Excellent");
  });
  it("falls back to raw for unknown condition", () => {
    expect(conditionLabel("mystery")).toBe("mystery");
  });
  it("maps known category enums", () => {
    expect(categoryLabel("hype_fashion")).toBe("Hype fashion");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-06-06T12:00:00Z").getTime();
  it("returns just now for very recent times", () => {
    expect(relativeTime("2026-06-06T11:59:30Z", now)).toBe("just now");
  });
  it("returns minutes", () => {
    expect(relativeTime("2026-06-06T11:30:00Z", now)).toBe("30m ago");
  });
  it("returns hours", () => {
    expect(relativeTime("2026-06-06T09:00:00Z", now)).toBe("3h ago");
  });
  it("returns days", () => {
    expect(relativeTime("2026-06-04T12:00:00Z", now)).toBe("2d ago");
  });
});

describe("splitTitle", () => {
  it("splits on the em-dash separator", () => {
    expect(splitTitle("Air Jordan 1 — Lost & Found")).toEqual({
      head: "Air Jordan 1",
      tail: "Lost & Found",
    });
  });
  it("returns null tail when there is no separator", () => {
    expect(splitTitle("Plain Title")).toEqual({ head: "Plain Title", tail: null });
  });
});

describe("buildReadinessView", () => {
  const complete = {
    productName: "Air Jordan 1",
    title: "Air Jordan 1 Retro High OG",
    description: "A great pair of shoes in excellent condition with box.",
    bulletPoints: ["Deadstock", "Original box", "Size 10.5"],
    selectedMarketplaces: ["ebay", "grailed"],
    recommendedPriceCents: 42500,
    photoCount: 5,
    condition: "used_good" as const,
    productCategory: "sneakers",
    brand: "Jordan",
    size: "10.5",
    colorway: "Black/Red",
    itemSpecifics: {},
    savedEbayCategoryId: null,
    savedAspects: {},
    savedQuantity: null,
  };

  it("is ready when all blocking checks pass", () => {
    const r = buildReadinessView(complete);
    expect(r.ready).toBe(true);
    expect(r.pct).toBe(100);
  });

  it("is blocked when a blocking check fails", () => {
    const r = buildReadinessView({ ...complete, recommendedPriceCents: 0 });
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.id === "price")?.state).toBe("miss");
  });

  it("blocks a size-required item that has no size", () => {
    const r = buildReadinessView({ ...complete, size: null });
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.id === "size")?.state).toBe("miss");
  });

  it("treats low photo count as a non-blocking warning", () => {
    const r = buildReadinessView({ ...complete, photoCount: 1 });
    expect(r.ready).toBe(true);
    expect(r.checks.find((c) => c.id === "photos")?.state).toBe("warn");
  });

  it("requires at least one marketplace", () => {
    const r = buildReadinessView({ ...complete, selectedMarketplaces: [] });
    expect(r.ready).toBe(false);
  });
});
