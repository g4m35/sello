import { describe, expect, it, vi } from "vitest";

import type { Prisma } from "@/generated/prisma/client";

import {
  createEbayNotificationPublicKeyResolver,
  processEbayAccountDeletion,
  type AccountDeletionPrismaLike,
} from "./account-deletion";
import type { EbayConfig } from "./types";

function createFakePrisma(opts?: { connections?: { id: string }[] }) {
  const connections = opts?.connections ?? [];
  const calls = {
    findMany: vi.fn(async () => connections),
    deleteMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => ({
      count: args.where.id.in.length,
    })),
    jobLogCreate: vi.fn<
      (args: {
        data: {
          queueName: string;
          jobName: string;
          status: "SUCCEEDED";
          payload: Prisma.InputJsonValue;
        };
      }) => Promise<{ id: string }>
    >(async () => ({ id: "job-1" })),
  };
  const prisma: AccountDeletionPrismaLike = {
    marketplaceConnection: {
      findMany: calls.findMany,
      deleteMany: calls.deleteMany,
    },
    jobLog: { create: calls.jobLogCreate },
  };
  return { prisma, calls };
}

const validBody = JSON.stringify({
  notification: {
    notificationId: "n1",
    data: { userId: "ebay-user-1", username: "seller1" },
  },
});

describe("processEbayAccountDeletion", () => {
  it("does NO DB work when the signature is invalid", async () => {
    const { prisma, calls } = createFakePrisma();
    const result = await processEbayAccountDeletion(validBody, "sig", {
      prisma,
      verifySignature: vi.fn(async () => false),
    });

    expect(result).toEqual({ verified: false, matched: 0 });
    expect(calls.findMany).not.toHaveBeenCalled();
    expect(calls.deleteMany).not.toHaveBeenCalled();
    expect(calls.jobLogCreate).not.toHaveBeenCalled();
  });

  it("does NO DB work when the signature header is missing", async () => {
    const { prisma, calls } = createFakePrisma();
    const result = await processEbayAccountDeletion(validBody, null, {
      prisma,
      verifySignature: vi.fn(async ({ signatureHeader }) => signatureHeader != null),
    });

    expect(result.verified).toBe(false);
    expect(calls.jobLogCreate).not.toHaveBeenCalled();
  });

  it("deletes the matching connection and audits when the signature is valid", async () => {
    const { prisma, calls } = createFakePrisma({ connections: [{ id: "conn-1" }] });
    const result = await processEbayAccountDeletion(validBody, "sig", {
      prisma,
      verifySignature: vi.fn(async () => true),
    });

    expect(result).toEqual({ verified: true, matched: 1 });
    expect(calls.findMany).toHaveBeenCalledWith({
      where: { marketplace: "ebay", externalUserId: { in: ["ebay-user-1", "seller1"] } },
      select: { id: true },
    });
    expect(calls.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["conn-1"] } },
    });
    expect(calls.jobLogCreate).toHaveBeenCalledTimes(1);
    expect(calls.jobLogCreate.mock.calls[0][0].data.payload).toMatchObject({
      matchedConnections: 1,
      notificationId: "n1",
    });
  });

  it("audits with zero matches but does not delete when no connection matches", async () => {
    const { prisma, calls } = createFakePrisma({ connections: [] });
    const result = await processEbayAccountDeletion(validBody, "sig", {
      prisma,
      verifySignature: vi.fn(async () => true),
    });

    expect(result).toEqual({ verified: true, matched: 0 });
    expect(calls.deleteMany).not.toHaveBeenCalled();
    expect(calls.jobLogCreate).toHaveBeenCalledTimes(1);
  });

  it("fails safely with no DB mutation when a verified body is malformed", async () => {
    const { prisma, calls } = createFakePrisma();
    const result = await processEbayAccountDeletion("not-json{", "sig", {
      prisma,
      verifySignature: vi.fn(async () => true),
    });

    expect(result).toEqual({ verified: true, matched: 0 });
    expect(calls.findMany).not.toHaveBeenCalled();
    expect(calls.deleteMany).not.toHaveBeenCalled();
    expect(calls.jobLogCreate).not.toHaveBeenCalled();
  });
});

describe("createEbayNotificationPublicKeyResolver", () => {
  const config = {
    environment: "production",
    clientId: "id",
    clientSecret: "secret",
    redirectUriName: "uri",
    marketplaceId: "EBAY_US",
    tokenEncryptionKey: "k",
  } as EbayConfig;

  it("fetches the key from the production getPublicKey endpoint and caches it", async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async (url: string) => {
        return {
          ok: true,
          json: async () => ({
            algorithm: "ECDSA",
            digest: "SHA1",
            key: "-----BEGIN PUBLIC KEY-----\nMFk=\n-----END PUBLIC KEY-----",
          }),
          _url: url,
        } as unknown as Response;
      },
    );
    const getApplicationToken = vi.fn(async () => "app-token");

    const resolve = createEbayNotificationPublicKeyResolver({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getApplicationToken,
    });

    const first = await resolve("key-123");
    const second = await resolve("key-123");

    expect(first?.algorithm).toBe("ECDSA");
    expect(second).toEqual(first);
    // Cached: the key endpoint is hit once across two resolves.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://api.ebay.com/commerce/notification/v1/public_key/key-123",
    );
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer app-token",
    );
  });

  it("returns null (fail closed) when getPublicKey responds non-OK", async () => {
    const resolve = createEbayNotificationPublicKeyResolver({
      config,
      fetchImpl: (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch,
      getApplicationToken: async () => "app-token",
    });
    expect(await resolve("key-123")).toBeNull();
  });
});
