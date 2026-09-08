import { describe, expect, it } from "vitest";
import { stockxIdentityIssue } from "./identity";
describe("StockX saved match identity", () => {
  const item = { styleCode: "DD1391-100", size: "10", brand: "Nike" };
  it("accepts the same style and size", () => expect(stockxIdentityIssue(item, { style: "dd1391 100", size: "10", brand: "Nike" })).toBeNull());
  it.each([{ style: "IB2990-100", size: "10" }, { style: "DD1391-100", size: "8.5" }, { size: "10" }])("rejects the wrong or unverified product: %j", (match) => expect(stockxIdentityIssue(item, match)).not.toBeNull());
});
