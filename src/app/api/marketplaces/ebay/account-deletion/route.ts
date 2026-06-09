import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";

// Public, unauthenticated endpoint required for eBay production compliance
// (Marketplace Account Deletion / Closure notifications).
//
// GET  -> challenge verification (SHA-256 of challengeCode + token + endpoint).
// POST -> receive a deletion notification, acknowledge immediately, and best-effort
//         purge the matching local eBay connection. Acknowledgement never fails.
//
// No auth, no cookies, no redirects.
export const runtime = "nodejs";

export async function GET(request: Request) {
  const challengeCode = new URL(request.url).searchParams.get("challenge_code");
  const verificationToken = process.env.EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN;
  const endpoint = process.env.EBAY_MARKETPLACE_DELETION_ENDPOINT;

  if (!challengeCode) {
    return NextResponse.json({ error: "Missing challenge_code" }, { status: 400 });
  }
  if (!verificationToken || !endpoint) {
    return NextResponse.json(
      { error: "eBay account deletion endpoint is not configured." },
      { status: 500 },
    );
  }

  // Hash order is mandated by eBay: challengeCode + verificationToken + endpoint.
  const challengeResponse = createHash("sha256")
    .update(challengeCode)
    .update(verificationToken)
    .update(endpoint)
    .digest("hex");

  return NextResponse.json({ challengeResponse }, { status: 200 });
}

type DeletionPayload = {
  notification?: {
    notificationId?: string;
    data?: { userId?: string; username?: string; eiasToken?: string };
  };
};

// Best-effort local cleanup + audit. Throwing here must never block the ack.
async function applyAccountDeletion(body: DeletionPayload | null): Promise<void> {
  const notification = body?.notification;
  const data = notification?.data;
  const identifiers = [data?.userId, data?.username, data?.eiasToken].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );

  const prisma = getPrisma();
  let matched = 0;

  if (identifiers.length > 0) {
    const connections = await prisma.marketplaceConnection.findMany({
      where: { marketplace: "ebay", externalUserId: { in: identifiers } },
      select: { id: true },
    });
    matched = connections.length;
    if (matched > 0) {
      // Deleting the connection removes the stored (encrypted) eBay tokens and
      // cascades to EbaySellerConfig — the local data tied to that eBay account.
      await prisma.marketplaceConnection.deleteMany({
        where: { id: { in: connections.map((c) => c.id) } },
      });
    }
  }

  // Audit record without storing the deleted user's identifiers (privacy-safe).
  await prisma.jobLog.create({
    data: {
      queueName: "compliance",
      jobName: "ebay_account_deletion",
      status: "SUCCEEDED",
      payload: {
        provider: "ebay",
        notificationId: notification?.notificationId ?? null,
        matchedConnections: matched,
      } as Prisma.InputJsonValue,
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as DeletionPayload | null;
    await applyAccountDeletion(body);
  } catch {
    // eBay requires a prompt 200; local cleanup/logging failures must not block it.
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
