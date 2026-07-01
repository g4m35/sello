import { describe, expect, it } from "vitest";

import { StockXIntegrationError } from "./errors";
import { decryptStockXToken, encryptStockXToken } from "./token-crypto";

describe("StockX token encryption", () => {
  it("round-trips tokens without storing the plaintext", () => {
    const key = "a".repeat(64);
    const encrypted = encryptStockXToken("access-token", key);
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("access-token");
    expect(decryptStockXToken(encrypted, key)).toBe("access-token");
  });

  it("fails closed on malformed ciphertext or a bad key", () => {
    expect(() => decryptStockXToken("not-a-token", "a".repeat(64))).toThrow(
      StockXIntegrationError,
    );
    expect(() => encryptStockXToken("token", "short")).toThrow(StockXIntegrationError);
  });
});
