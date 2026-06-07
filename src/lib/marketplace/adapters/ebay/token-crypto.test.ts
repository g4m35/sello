import { describe, expect, it } from "vitest";

import {
  decryptEbayToken,
  encryptEbayToken,
  normalizeTokenCryptoError,
} from "./token-crypto";

const key =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const otherKey =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

describe("eBay token crypto", () => {
  it("encrypts and decrypts token values with AES-GCM", () => {
    const ciphertext = encryptEbayToken("access-token-secret", key);

    expect(ciphertext).not.toContain("access-token-secret");
    expect(decryptEbayToken(ciphertext, key)).toBe("access-token-secret");
  });

  it("fails when decrypting with the wrong key", () => {
    const ciphertext = encryptEbayToken("refresh-token-secret", key);

    expect(() => decryptEbayToken(ciphertext, otherKey)).toThrow();
  });

  it("fails safely for malformed ciphertext without leaking token data", () => {
    const error = normalizeTokenCryptoError();

    expect(error.code).toBe("EBAY_NOT_CONFIGURED");
    expect(error.message).not.toContain("refresh-token-secret");
  });
});
