import type { Prisma } from "@/generated/prisma/client";

import { getEbayConfig } from "./config";
import { fetchEbayApplicationToken } from "./oauth";
import {
  verifyEbayNotificationSignature,
  type EbayNotificationPublicKey,
  type EbayPublicKeyResolver,
} from "./notification-signature";
import type { EbayConfig, EbayEnvironment } from "./types";

// Structural subset of the Prisma client the deletion handler needs, so tests
// use a tiny fake instead of the full client surface.
export type AccountDeletionPrismaLike = {
  marketplaceConnection: {
    findMany(args: {
      where: { marketplace: "ebay"; externalUserId: { in: string[] } };
      select: { id: true };
    }): Promise<{ id: string }[]>;
    deleteMany(args: { where: { id: { in: string[] } } }): Promise<{ count: number }>;
  };
  jobLog: {
    create(args: {
      data: {
        queueName: string;
        jobName: string;
        status: "SUCCEEDED";
        payload: Prisma.InputJsonValue;
      };
    }): Promise<{ id: string }>;
  };
};

type DeletionPayload = {
  notification?: {
    notificationId?: string;
    data?: { userId?: string; username?: string; eiasToken?: string };
  };
};

export type VerifyEbaySignatureFn = (args: {
  rawBody: string;
  signatureHeader: string | null;
}) => Promise<boolean>;

export type ProcessEbayAccountDeletionDeps = {
  prisma: AccountDeletionPrismaLike;
  verifySignature: VerifyEbaySignatureFn;
};

// Verifies the inbound notification's signature and, only if authentic, purges
// the matching local eBay connection (which removes the stored encrypted tokens
// and cascades to EbaySellerConfig) and writes a privacy-safe audit record.
// Unverified or malformed requests perform NO database work — the caller still
// acknowledges eBay with a 2xx so the endpoint stays healthy.
export async function processEbayAccountDeletion(
  rawBody: string,
  signatureHeader: string | null,
  deps: ProcessEbayAccountDeletionDeps,
): Promise<{ verified: boolean; matched: number }> {
  const verified = await deps.verifySignature({ rawBody, signatureHeader });
  if (!verified) {
    return { verified: false, matched: 0 };
  }

  let body: DeletionPayload;
  try {
    body = JSON.parse(rawBody) as DeletionPayload;
  } catch {
    return { verified: true, matched: 0 };
  }

  const notification = body?.notification;
  const data = notification?.data;
  const identifiers = [data?.userId, data?.username, data?.eiasToken].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );

  let matched = 0;
  if (identifiers.length > 0) {
    const connections = await deps.prisma.marketplaceConnection.findMany({
      where: { marketplace: "ebay", externalUserId: { in: identifiers } },
      select: { id: true },
    });
    matched = connections.length;
    if (matched > 0) {
      await deps.prisma.marketplaceConnection.deleteMany({
        where: { id: { in: connections.map((c) => c.id) } },
      });
    }
  }

  await deps.prisma.jobLog.create({
    data: {
      queueName: "compliance",
      jobName: "ebay_account_deletion",
      status: "SUCCEEDED",
      payload: {
        provider: "ebay",
        notificationId: notification?.notificationId ?? null,
        matchedConnections: matched,
      },
    },
  });

  return { verified: true, matched };
}

const notificationApiBaseUrls: Record<EbayEnvironment, string> = {
  sandbox: "https://api.sandbox.ebay.com",
  production: "https://api.ebay.com",
};

// Builds the getPublicKey resolver used to validate notification signatures. The
// public key is cached per key id (eBay recommends ~1 hour) to avoid hammering
// the Notification API. Any HTTP/parse problem resolves to null so verification
// fails closed.
export function createEbayNotificationPublicKeyResolver(opts: {
  config: EbayConfig;
  fetchImpl?: typeof fetch;
  getApplicationToken?: (
    config: EbayConfig,
    fetchImpl: typeof fetch,
  ) => Promise<string>;
  ttlMs?: number;
  now?: () => number;
}): EbayPublicKeyResolver {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const getApplicationToken = opts.getApplicationToken ?? fetchEbayApplicationToken;
  const ttlMs = opts.ttlMs ?? 60 * 60 * 1000;
  const now = opts.now ?? (() => Date.now());
  const base = notificationApiBaseUrls[opts.config.environment];
  const cache = new Map<
    string,
    { value: EbayNotificationPublicKey; expiresAt: number }
  >();

  return async (keyId) => {
    const cached = cache.get(keyId);
    if (cached && cached.expiresAt > now()) {
      return cached.value;
    }

    const token = await getApplicationToken(opts.config, fetchImpl);
    const response = await fetchImpl(
      `${base}/commerce/notification/v1/public_key/${encodeURIComponent(keyId)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    );
    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as {
      algorithm?: string;
      digest?: string;
      key?: string;
    };
    if (!json.key || !json.algorithm || !json.digest) {
      return null;
    }

    const value: EbayNotificationPublicKey = {
      algorithm: json.algorithm,
      digest: json.digest,
      key: json.key,
    };
    cache.set(keyId, { value, expiresAt: now() + ttlMs });
    return value;
  };
}

let cachedDefaultResolver: EbayPublicKeyResolver | null = null;

function getDefaultPublicKeyResolver(): EbayPublicKeyResolver | null {
  if (cachedDefaultResolver) {
    return cachedDefaultResolver;
  }
  let config: EbayConfig;
  try {
    config = getEbayConfig();
  } catch {
    // eBay app credentials are not configured: we cannot validate signatures, so
    // verification fails closed and no notification is ever acted upon.
    return null;
  }
  cachedDefaultResolver = createEbayNotificationPublicKeyResolver({ config });
  return cachedDefaultResolver;
}

// Default verifier used by the route. Never throws; resolves to false whenever
// the signature cannot be confirmed, including when eBay app credentials are
// absent.
export const defaultVerifyEbaySignature: VerifyEbaySignatureFn = async (args) => {
  const resolvePublicKey = getDefaultPublicKeyResolver();
  if (!resolvePublicKey) {
    return false;
  }
  try {
    return await verifyEbayNotificationSignature({
      rawBody: args.rawBody,
      signatureHeader: args.signatureHeader,
      resolvePublicKey,
    });
  } catch {
    return false;
  }
};
