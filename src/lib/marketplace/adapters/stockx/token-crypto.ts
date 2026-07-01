import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { StockXIntegrationError, stockxErrorCodes } from "./errors";

const algorithm = "aes-256-gcm";
const tokenPrefix = "v1";

export function encryptStockXToken(token: string, keyHex: string): string {
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

export function decryptStockXToken(ciphertext: string, keyHex: string): string {
  const key = parseKey(keyHex);
  const [prefix, ivRaw, authTagRaw, encryptedRaw] = ciphertext.split(".");

  if (prefix !== tokenPrefix || !ivRaw || !authTagRaw || !encryptedRaw) {
    throw normalizeStockXTokenCryptoError();
  }

  try {
    const decipher = createDecipheriv(algorithm, key, Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(authTagRaw, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw normalizeStockXTokenCryptoError();
  }
}

export function normalizeStockXTokenCryptoError() {
  return new StockXIntegrationError(
    stockxErrorCodes.reconnectRequired,
    "Unable to decrypt the stored StockX token. Reconnect StockX.",
    503,
  );
}

function parseKey(keyHex: string) {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new StockXIntegrationError(
      stockxErrorCodes.notConfigured,
      "STOCKX_TOKEN_ENCRYPTION_KEY must be a 32-byte hex key.",
      503,
      { variable: "STOCKX_TOKEN_ENCRYPTION_KEY" },
    );
  }
  return key;
}
