import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { EtsyIntegrationError, etsyErrorCodes } from "./errors";

// Same scheme as the eBay adapter: AES-256-GCM with a versioned prefix. Tokens
// are only ever stored encrypted (MarketplaceConnection.accessTokenEnc /
// refreshTokenEnc) and decrypted server-side for outbound calls.
const algorithm = "aes-256-gcm";
const tokenPrefix = "v1";

export function encryptEtsyToken(token: string, keyHex: string): string {
  const key = parseKey(keyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    tokenPrefix,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptEtsyToken(ciphertext: string, keyHex: string): string {
  const key = parseKey(keyHex);
  const [prefix, ivRaw, authTagRaw, encryptedRaw] = ciphertext.split(".");

  if (prefix !== tokenPrefix || !ivRaw || !authTagRaw || !encryptedRaw) {
    throw normalizeTokenCryptoError();
  }

  try {
    const decipher = createDecipheriv(algorithm, key, Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(authTagRaw, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw normalizeTokenCryptoError();
  }
}

export function normalizeTokenCryptoError() {
  return new EtsyIntegrationError(
    etsyErrorCodes.reconnectRequired,
    "Unable to decrypt the stored Etsy token. Reconnect Etsy.",
    503,
  );
}

function parseKey(keyHex: string) {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new EtsyIntegrationError(
      etsyErrorCodes.notConfigured,
      "ETSY_TOKEN_ENCRYPTION_KEY must be a 32-byte hex key.",
      503,
      { variable: "ETSY_TOKEN_ENCRYPTION_KEY" },
    );
  }
  return key;
}
