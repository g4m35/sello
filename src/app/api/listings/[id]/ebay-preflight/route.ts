import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import {
  ebayAspectRequirementsFromTaxonomy,
  type EbayAspectRequirementSet,
} from "@/lib/listing/ebay-aspects";
import {
  EbaySandboxClient,
  getEbayApplicationAccessToken,
} from "@/lib/marketplace/adapters/ebay/client";
import { getEbayConfig } from "@/lib/marketplace/adapters/ebay/config";
import { toEbayErrorPayload } from "@/lib/marketplace/adapters/ebay/errors";
import {
  preflightEbayListing,
  type EbayPreflightPrismaLike,
} from "@/lib/marketplace/adapters/ebay/preflight";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function getTaxonomyAspectRequirements(
  categoryId: string,
): Promise<EbayAspectRequirementSet | null> {
  try {
    const config = getEbayConfig();
    const appToken = await getEbayApplicationAccessToken(config);
    const client = new EbaySandboxClient(
      appToken,
      config.marketplaceId,
      fetch,
      config.environment,
    );
    const aspects = await client.getItemAspectsForCategory(categoryId);
    const requirements = ebayAspectRequirementsFromTaxonomy(aspects);
    return requirements.length > 0 ? { source: "taxonomy", requirements } : null;
  } catch {
    return null;
  }
}

// Dry-run only: validates the listing and previews the exact eBay payloads. It
// may read eBay Taxonomy metadata for category-specific aspect requirements, but
// it never creates or modifies an eBay inventory item, offer, or listing.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { id } = await params;

    const result = await preflightEbayListing(
      getPrisma() as unknown as EbayPreflightPrismaLike,
      { userId: user.id, inventoryItemId: id },
      process.env,
      { aspectRequirementProvider: getTaxonomyAspectRequirements },
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("EBAY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }

    const { payload, status } = toEbayErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}
