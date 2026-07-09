import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { accountScope, inventoryChildScope } from "./scope";

describe("account scope helpers", () => {
  it("scopes InventoryItem rows by accountId", () => {
    expect(accountScope({ id: "acc-1" })).toEqual({ accountId: "acc-1" });
  });

  it("scopes child rows via the inventoryItem relation", () => {
    expect(inventoryChildScope({ id: "acc-1" })).toEqual({
      inventoryItem: { accountId: "acc-1" },
    });
  });
});
