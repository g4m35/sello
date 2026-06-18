import { describe, expect, it } from "vitest";

import { csvCell, toCsv } from "@/lib/view/csv";
import type { ItemView } from "@/lib/view/types";

function makeItem(overrides: Partial<ItemView> = {}): ItemView {
  return {
    id: "item-1",
    title: "Nike Dunk Low",
    productName: "Dunk Low",
    brand: "Nike",
    category: "Sneakers",
    condition: "Used - Good",
    size: "10.5",
    colorway: "Panda",
    priceCents: 12500,
    status: "draft",
    lifecycleState: "draft",
    statusLabel: "Draft",
    ready: false,
    missingCount: 0,
    photoCount: 3,
    updatedAt: "2026-06-16T00:00:00.000Z",
    draftId: null,
    channels: [],
    ...overrides,
  };
}

describe("csvCell formula-injection escaping", () => {
  it("neutralizes a leading = formula", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
  });

  it("neutralizes a leading + formula", () => {
    expect(csvCell("+A1")).toBe("'+A1");
  });

  it("neutralizes a leading @ formula", () => {
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("neutralizes a leading - formula", () => {
    expect(csvCell("-2")).toBe("'-2");
  });

  it("neutralizes a leading tab", () => {
    // Prefixing forces text; a tab is not a CSV delimiter so no quoting is needed.
    expect(csvCell("\t=1+1")).toBe("'\t=1+1");
  });

  it("neutralizes a leading carriage return", () => {
    expect(csvCell("\rfoo")).toBe('"\'\rfoo"');
  });

  it("leaves normal values unchanged", () => {
    expect(csvCell("Nike Dunk")).toBe("Nike Dunk");
    expect(csvCell("10.5")).toBe("10.5");
    expect(csvCell(125)).toBe("125");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("still quotes values containing comma, quote, newline, or carriage return", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("a\rb")).toBe('"a\rb"');
  });

  it("escapes AND quotes a formula cell that also contains a comma", () => {
    expect(csvCell("=HYPERLINK(1,2)")).toBe('"\'=HYPERLINK(1,2)"');
  });
});

describe("toCsv", () => {
  it("emits a header row followed by one row per item", () => {
    const csv = toCsv([makeItem()]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "id,title,brand,category,condition,size,color,price_usd,status,photos,updated_at",
    );
    expect(lines[1]).toBe(
      "item-1,Nike Dunk Low,Nike,Sneakers,Used - Good,10.5,Panda,125.00,Draft,3,2026-06-16T00:00:00.000Z",
    );
  });

  it("neutralizes formula injection in title/brand/size/colorway columns", () => {
    const csv = toCsv([
      makeItem({
        title: "=1+1",
        brand: "+A1",
        size: "@SUM(A1)",
        colorway: "-2",
      }),
    ]);
    const row = csv.split("\n")[1];
    const cells = row.split(",");
    expect(cells[1]).toBe("'=1+1"); // title
    expect(cells[2]).toBe("'+A1"); // brand
    expect(cells[5]).toBe("'@SUM(A1)"); // size
    expect(cells[6]).toBe("'-2"); // color
  });

  it("formats null brand/size/colorway/price as empty (not escaped)", () => {
    const csv = toCsv([
      makeItem({ brand: null, size: null, colorway: null, priceCents: null }),
    ]);
    const cells = csv.split("\n")[1].split(",");
    expect(cells[2]).toBe(""); // brand
    expect(cells[5]).toBe(""); // size
    expect(cells[6]).toBe(""); // color
    expect(cells[7]).toBe(""); // price_usd
  });
});
