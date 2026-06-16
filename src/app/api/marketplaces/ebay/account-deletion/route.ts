import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { getPrisma } from "@/lib/prisma";
import {
  defaultVerifyEbaySignature,
  processEbayAccountDeletion,
  type AccountDeletionPrismaLike,
} from "@/lib/marketplace/adapters/ebay/account-deletion";

// Public, unauthenticated endpoint required for eBay production compliance
// (Marketplace Account Deletion / Closure notifications).
//
// GET  -> challenge verification (SHA-256 of challengeCode + token + endpoint).
// POST -> receive a deletion notification, acknowledge immediately, and — only
//         after verifying eBay's X-EBAY-SIGNATURE — purge the matching local
//         eBay connection. The acknowledgement never fails; unverified requests
//         do no database work.
//
// No cookies, no redirects. POST authenticity comes from the signed notification.
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

export async function POST(request: Request) {
  // Read the EXACT raw body bytes: signature verification must run over what
  // eBay signed, not a re-serialized parse.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-ebay-signature");

  try {
    await processEbayAccountDeletion(rawBody, signatureHeader, {
      prisma: getPrisma() as unknown as AccountDeletionPrismaLike,
      verifySignature: defaultVerifyEbaySignature,
    });
  } catch {
    // eBay requires a prompt 2xx; local verify/cleanup/logging failures must not
    // block the acknowledgement.
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
