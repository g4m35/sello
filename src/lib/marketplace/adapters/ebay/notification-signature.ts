import { createPublicKey, createVerify } from "node:crypto";

// Verifies the authenticity of eBay event notifications (Marketplace Account
// Deletion/Closure) via the X-EBAY-SIGNATURE header.
//
// eBay's scheme (official docs + event-notification-nodejs-sdk):
//   1. X-EBAY-SIGNATURE is base64-encoded JSON:
//        { "alg": "ECDSA", "kid": "<public key id>", "signature": "<base64>", "digest": "SHA1" }
//   2. Fetch the public key for `kid` from the Notification API getPublicKey
//      endpoint (an Application/client-credentials OAuth token is required).
//   3. The key comes back as an X.509/SPKI PEM with `algorithm` (ECDSA) and
//      `digest` (SHA1). Verify the base64, DER-encoded ECDSA signature against
//      the EXACT raw request body bytes.
//
// Every failure path returns false (fail closed): a missing/invalid signature,
// an unresolvable key, an unsupported alg/digest, or any thrown error never
// throws out of here, so the webhook can ack eBay while refusing to act on
// unverified input. Docs:
//   https://developer.ebay.com/develop/guides-v2/marketplace-user-account-deletion
//   https://developer.ebay.com/api-docs/commerce/notification/resources/public_key/methods/getPublicKey

export type EbayNotificationPublicKey = {
  algorithm: string;
  digest: string;
  /** X.509/SPKI public key, PEM-encoded (or bare base64 SPKI). */
  key: string;
};

export type EbayPublicKeyResolver = (
  keyId: string,
) => Promise<EbayNotificationPublicKey | null>;

export type ParsedEbaySignatureHeader = {
  alg: string;
  kid: string;
  signature: string;
  digest: string;
};

export function parseEbaySignatureHeader(
  headerValue: string | null,
): ParsedEbaySignatureHeader | null {
  if (!headerValue) {
    return null;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(headerValue, "base64").toString("utf8");
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") {
    return null;
  }
  const { alg, kid, signature, digest } = json as Record<string, unknown>;
  if (typeof kid !== "string" || kid.length === 0) {
    return null;
  }
  if (typeof signature !== "string" || signature.length === 0) {
    return null;
  }
  return {
    alg: typeof alg === "string" ? alg : "",
    kid,
    signature,
    digest: typeof digest === "string" ? digest : "",
  };
}

const supportedAlgorithms = new Set(["ECDSA"]);
const digestToHash: Record<string, string> = { SHA1: "sha1", SHA256: "sha256" };

export async function verifyEbayNotificationSignature(args: {
  rawBody: string | Buffer;
  signatureHeader: string | null;
  resolvePublicKey: EbayPublicKeyResolver;
}): Promise<boolean> {
  const parsed = parseEbaySignatureHeader(args.signatureHeader);
  if (!parsed) {
    return false;
  }

  let publicKey: EbayNotificationPublicKey | null;
  try {
    publicKey = await args.resolvePublicKey(parsed.kid);
  } catch {
    return false;
  }
  if (!publicKey) {
    return false;
  }
  if (!supportedAlgorithms.has(publicKey.algorithm.trim().toUpperCase())) {
    return false;
  }
  const hash = digestToHash[publicKey.digest.trim().toUpperCase()];
  if (!hash) {
    return false;
  }

  const pem = normalizePublicKeyToPem(publicKey.key);
  if (!pem) {
    return false;
  }

  try {
    const verifier = createVerify(hash);
    verifier.update(
      typeof args.rawBody === "string"
        ? Buffer.from(args.rawBody, "utf8")
        : args.rawBody,
    );
    verifier.end();
    return verifier.verify(
      createPublicKey(pem),
      Buffer.from(parsed.signature, "base64"),
    );
  } catch {
    return false;
  }
}

function normalizePublicKeyToPem(key: string): string | null {
  const trimmed = key.trim();
  if (trimmed.includes("BEGIN PUBLIC KEY")) {
    return trimmed;
  }
  // Be tolerant of a bare base64 SPKI body with no PEM armor.
  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 0) {
    const body =
      trimmed.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? trimmed;
    return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
  }
  return null;
}
