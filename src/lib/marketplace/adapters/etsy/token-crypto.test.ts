import { describe, expect, it } from "vitest";

import { EtsyIntegrationError, etsyErrorCodes } from "./errors";
import { decryptEtsyToken, encryptEtsyToken } from "./token-crypto";

const key = "a".repeat(64); // 32 bytes hex

describe("etsy token crypto", () => {
  it("round-trips an encrypted token", () => {
    const token = "1234567.live-access-token-value";
    const ciphertext = encryptEtsyToken(token, key);
    expect(ciphertext).not.toContain(token);
    expect(ciphertext.startsWith("v1.")).toBe(true);
    expect(decryptEtsyToken(ciphertext, key)).toBe(token);
  });

  it("rejects a tampered ciphertext with reconnectRequired", () => {
    const parts = encryptEtsyToken("secret", key).split(".");
    // Corrupt the GCM auth tag so decryption authentication fails.
    parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
    const tampered = parts.join(".");
    try {
      decryptEtsyToken(tampered, key);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EtsyIntegrationError);
      expect((error as EtsyIntegrationError).code).toBe(
        etsyErrorCodes.reconnectRequired,
      );
    }
  });

  it("rejects a wrong-length key with notConfigured", () => {
    expect(() => encryptEtsyToken("x", "abcd")).toThrow(EtsyIntegrationError);
  });
});
