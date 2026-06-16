import { createSign, generateKeyPairSync } from "node:crypto";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  parseEbaySignatureHeader,
  verifyEbayNotificationSignature,
  type EbayNotificationPublicKey,
} from "./notification-signature";

// A real EC keypair (the curve eBay uses for notification signatures) so the
// tests exercise genuine ECDSA/SHA1 DER verification, not a mock of it.
let publicKeyPem: string;
let privateKeyPem: string;

beforeAll(() => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
});

function signBody(rawBody: string): string {
  const signer = createSign("SHA1");
  signer.update(rawBody);
  signer.end();
  return signer.sign(privateKeyPem).toString("base64");
}

function makeHeader(overrides: Record<string, unknown> = {}, rawBody = "{}"): string {
  const payload = {
    alg: "ECDSA",
    kid: "key-1",
    signature: signBody(rawBody),
    digest: "SHA1",
    ...overrides,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

const resolveKey =
  (key: EbayNotificationPublicKey | null) => vi.fn(async () => key);

describe("parseEbaySignatureHeader", () => {
  it("decodes a base64 JSON header into its fields", () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "ECDSA", kid: "abc", signature: "sig", digest: "SHA1" }),
    ).toString("base64");
    expect(parseEbaySignatureHeader(header)).toEqual({
      alg: "ECDSA",
      kid: "abc",
      signature: "sig",
      digest: "SHA1",
    });
  });

  it("returns null for a missing, non-base64, or kid/signature-less header", () => {
    expect(parseEbaySignatureHeader(null)).toBeNull();
    expect(parseEbaySignatureHeader("")).toBeNull();
    expect(parseEbaySignatureHeader("@@not base64@@")).toBeNull();
    expect(
      parseEbaySignatureHeader(
        Buffer.from(JSON.stringify({ kid: "abc" })).toString("base64"),
      ),
    ).toBeNull();
  });
});

describe("verifyEbayNotificationSignature", () => {
  const rawBody = JSON.stringify({ notification: { notificationId: "n1" } });

  it("returns true for a valid ECDSA/SHA1 signature over the raw body", async () => {
    const resolve = resolveKey({
      algorithm: "ECDSA",
      digest: "SHA1",
      key: publicKeyPem,
    });
    const ok = await verifyEbayNotificationSignature({
      rawBody,
      signatureHeader: makeHeader({}, rawBody),
      resolvePublicKey: resolve,
    });
    expect(ok).toBe(true);
    expect(resolve).toHaveBeenCalledWith("key-1");
  });

  it("returns false when the body was tampered after signing", async () => {
    const ok = await verifyEbayNotificationSignature({
      rawBody: rawBody + " ",
      signatureHeader: makeHeader({}, rawBody),
      resolvePublicKey: resolveKey({
        algorithm: "ECDSA",
        digest: "SHA1",
        key: publicKeyPem,
      }),
    });
    expect(ok).toBe(false);
  });

  it("returns false when the signature header is missing", async () => {
    const ok = await verifyEbayNotificationSignature({
      rawBody,
      signatureHeader: null,
      resolvePublicKey: resolveKey({
        algorithm: "ECDSA",
        digest: "SHA1",
        key: publicKeyPem,
      }),
    });
    expect(ok).toBe(false);
  });

  it("returns false (fail closed) when the public key cannot be resolved", async () => {
    const ok = await verifyEbayNotificationSignature({
      rawBody,
      signatureHeader: makeHeader({}, rawBody),
      resolvePublicKey: resolveKey(null),
    });
    expect(ok).toBe(false);
  });

  it("returns false (fail closed) when the resolver throws", async () => {
    const ok = await verifyEbayNotificationSignature({
      rawBody,
      signatureHeader: makeHeader({}, rawBody),
      resolvePublicKey: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    expect(ok).toBe(false);
  });

  it("rejects an unsupported algorithm or digest", async () => {
    expect(
      await verifyEbayNotificationSignature({
        rawBody,
        signatureHeader: makeHeader({}, rawBody),
        resolvePublicKey: resolveKey({
          algorithm: "RSA",
          digest: "SHA1",
          key: publicKeyPem,
        }),
      }),
    ).toBe(false);

    expect(
      await verifyEbayNotificationSignature({
        rawBody,
        signatureHeader: makeHeader({}, rawBody),
        resolvePublicKey: resolveKey({
          algorithm: "ECDSA",
          digest: "MD5",
          key: publicKeyPem,
        }),
      }),
    ).toBe(false);
  });

  it("returns false when verifying against a different public key", async () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const ok = await verifyEbayNotificationSignature({
      rawBody,
      signatureHeader: makeHeader({}, rawBody),
      resolvePublicKey: resolveKey({
        algorithm: "ECDSA",
        digest: "SHA1",
        key: other.publicKey.export({ type: "spki", format: "pem" }).toString(),
      }),
    });
    expect(ok).toBe(false);
  });
});
