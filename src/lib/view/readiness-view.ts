import {
  countMeaningfulBullets,
  PLACEHOLDER_PRODUCT_NAME,
  READINESS_THRESHOLDS,
} from "@/lib/lifecycle/readiness";
import type { ReadinessCheckView, ReadinessView } from "@/lib/view/types";

export type ReadinessViewInput = {
  productName: string | null | undefined;
  title: string;
  description: string;
  bulletPoints: string[];
  selectedMarketplaces: string[];
  recommendedPriceCents: number | null | undefined;
  photoCount: number;
};

/**
 * Builds the readiness checklist for the UI. The five BLOCKING checks mirror
 * evaluateReadiness() exactly, so the UI's "ready/blocked" state always matches
 * the server-side approve/publish gate. Photo count is an informational warn
 * (the backend does not gate on it).
 */
export function buildReadinessView(input: ReadinessViewInput): ReadinessView {
  const productName = input.productName?.trim() ?? "";
  const title = input.title.trim();
  const description = input.description.trim();
  const bullets = countMeaningfulBullets(input.bulletPoints);
  const price = input.recommendedPriceCents;

  const checks: ReadinessCheckView[] = [
    {
      id: "identified",
      title: "Product identified",
      sub:
        productName && productName !== PLACEHOLDER_PRODUCT_NAME
          ? productName
          : "Awaiting identification",
      state: productName && productName !== PLACEHOLDER_PRODUCT_NAME ? "done" : "miss",
      blocking: true,
    },
    {
      id: "title",
      title: "Title",
      sub: `${title.length}/${READINESS_THRESHOLDS.titleMinLength}+ characters`,
      state: title.length >= READINESS_THRESHOLDS.titleMinLength ? "done" : "miss",
      blocking: true,
    },
    {
      id: "description",
      title: "Description",
      sub: `${description.length}/${READINESS_THRESHOLDS.descriptionMinLength}+ characters`,
      state:
        description.length >= READINESS_THRESHOLDS.descriptionMinLength ? "done" : "miss",
      blocking: true,
    },
    {
      id: "bullets",
      title: "Highlights",
      sub: `${bullets}/${READINESS_THRESHOLDS.minBulletPoints}+ bullet points`,
      state: bullets >= READINESS_THRESHOLDS.minBulletPoints ? "done" : "miss",
      blocking: true,
    },
    {
      id: "price",
      title: "Price",
      sub: price != null && price > 0 ? "Seller price set" : "Set a price above $0",
      state: price != null && Number.isFinite(price) && price > 0 ? "done" : "miss",
      blocking: true,
    },
    {
      id: "marketplaces",
      title: "Channels",
      sub: `${input.selectedMarketplaces.length} selected`,
      state:
        input.selectedMarketplaces.length >= READINESS_THRESHOLDS.minMarketplaces
          ? "done"
          : "miss",
      blocking: true,
    },
    {
      id: "photos",
      title: "Photos",
      sub: `${input.photoCount} of 3 recommended`,
      state: input.photoCount >= 3 ? "done" : "warn",
      blocking: false,
    },
  ];

  const totalCount = checks.length;
  const doneCount = checks.filter((c) => c.state === "done").length;
  const ready = !checks.some((c) => c.blocking && c.state === "miss");
  const pct = Math.round((doneCount / totalCount) * 100);

  return { ready, pct, doneCount, totalCount, checks };
}
