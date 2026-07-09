import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getActiveAccount } from "@/lib/billing/account";
import { getPrisma } from "@/lib/prisma";
import { getEbayConfig } from "@/lib/marketplace/adapters/ebay/config";
import {
  EbaySandboxClient,
  getUsableEbayAccessToken,
  type EbayTokenPrismaLike,
} from "@/lib/marketplace/adapters/ebay/client";
import {
  EbayIntegrationError,
  ebayErrorCodes,
  toEbayErrorPayload,
} from "@/lib/marketplace/adapters/ebay/errors";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

const defaultMerchantLocationKey = "sello-default-location";

// Seller-entered ship-from address. US-only for now (matches EBAY_US scope).
const locationInputSchema = z.object({
  name: z.string().trim().min(1, "Location name is required.").max(100),
  addressLine1: z.string().trim().min(1, "Address line 1 is required.").max(128),
  addressLine2: z.string().trim().max(128).optional(),
  city: z.string().trim().min(1, "City is required.").max(64),
  stateOrProvince: z.string().trim().min(2, "State is required.").max(64),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, "Enter a valid US ZIP code."),
  country: z.literal("US"),
  phone: z.string().trim().max(26).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    const config = getEbayConfig();

    const parsed = locationInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((issue) => issue.message)
        .join(" ");
      throw new AppError(message || "Invalid ship-from address.", 400);
    }
    const input = parsed.data;

    type LocationsPrisma = EbayTokenPrismaLike & {
      marketplaceConnection: EbayTokenPrismaLike["marketplaceConnection"] & {
        findUnique(args: {
          where: {
            userId_marketplace_environment?: {
              userId: string;
              marketplace: "ebay";
              environment: string;
            };
            accountId_marketplace_environment?: {
              accountId: string;
              marketplace: "ebay";
              environment: string;
            };
          };
        }): Promise<{
          id: string;
          accessTokenEnc: string;
          refreshTokenEnc: string;
          accessTokenExpiresAt: Date;
        } | null>;
      };
    };
    const rawPrisma = getPrisma();
    const account = await getActiveAccount(user.id, rawPrisma);
    const prisma = rawPrisma as unknown as LocationsPrisma;
    const connection = await prisma.marketplaceConnection.findUnique({
      where: {
        accountId_marketplace_environment: {
          accountId: account.id,
          marketplace: "ebay",
          environment: config.environment,
        },
      },
    });

    if (!connection) {
      throw new EbayIntegrationError(
        ebayErrorCodes.notConnected,
        "Connect eBay before creating an inventory location.",
        404,
      );
    }

    const accessToken = await getUsableEbayAccessToken(prisma, connection, config);
    const client = new EbaySandboxClient(
      accessToken,
      config.marketplaceId,
      fetch,
      config.environment,
    );

    await client.createInventoryLocation(defaultMerchantLocationKey, {
      name: input.name,
      location: {
        address: {
          addressLine1: input.addressLine1,
          ...(input.addressLine2 ? { addressLine2: input.addressLine2 } : {}),
          city: input.city,
          stateOrProvince: input.stateOrProvince,
          postalCode: input.postalCode,
          country: input.country,
        },
      },
      locationTypes: ["WAREHOUSE"],
      merchantLocationStatus: "ENABLED",
      ...(input.phone ? { phone: input.phone } : {}),
    });

    return NextResponse.json({
      ok: true,
      merchantLocationKey: defaultMerchantLocationKey,
    });
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("EBAY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }

    const { payload, status } = toEbayErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}
