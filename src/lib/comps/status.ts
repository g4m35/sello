export type AutoCompSummaryStatus = {
  validComps: number;
  confidence: string;
  soldCompCount?: number;
  activeCompCount?: number;
  pricingBasis?: string;
};

export type AutoCompDiscoveryStatus = {
  status: string;
  autoDiscoveryEnabled: boolean;
  enabledSources: string[];
  /** Kill switch for paid sold-comp providers. Undefined = unknown (treated as on). */
  paidProvidersEnabled?: boolean;
};

export function getAutoCompStatusCopy(
  discovery: AutoCompDiscoveryStatus,
  summary: AutoCompSummaryStatus,
) {
  if (!discovery.autoDiscoveryEnabled) {
    return {
      variant: "info" as const,
      title: "Fresh sold comps are disabled",
      desc:
        "Manual comps still work. Fresh sold comps are off until a safe source is enabled.",
    };
  }
  if (discovery.paidProvidersEnabled === false && summary.validComps === 0) {
    return {
      variant: "info" as const,
      title: "Fresh sold comps are disabled",
      desc:
        "Manual comps still work. Fresh sold comps are turned off right now, so add a manual comp to price this item.",
    };
  }
  if (discovery.enabledSources.length === 0) {
    return {
      variant: "warn" as const,
      title: "No sold-comp source connected yet",
      desc:
        "Manual comps still work. A sold-comp source can be connected to gather comps automatically.",
    };
  }
  if (discovery.status === "error") {
    return {
      variant: "error" as const,
      title: "Auto comps hit a source error",
      desc:
        "Manual comps still work. Source errors are isolated and do not block draft editing.",
    };
  }
  if (discovery.status === "no_comps_found") {
    return {
      variant: "warn" as const,
      title: "No automatic comps found",
      desc:
        "The search ran, but no safe comparable results matched strongly enough. Add a manual comp or try again later.",
    };
  }
  if (discovery.status === "needs_review" || summary.confidence === "low") {
    return {
      variant: "warn" as const,
      title: "Auto comps need review",
      desc:
        "Sello found possible comps, but confidence is low. Review the range before accepting a price.",
    };
  }
  if (discovery.status === "auto_priced") {
    return {
      variant: "info" as const,
      title: "High-confidence auto price applied",
      desc:
        "Sello found enough comparable data to fill the recommended price. You can still edit it.",
    };
  }
  if (summary.validComps > 0) {
    if (summary.pricingBasis === "active_market_estimate" || (summary.soldCompCount ?? 0) === 0) {
      return {
        variant: "info" as const,
        title: "Market listing estimate ready",
        desc:
          "This estimate uses active listings as asking-price signals, not sold comps. Review before accepting.",
      };
    }
    if (summary.pricingBasis === "mixed_comps") {
      return {
        variant: "info" as const,
        title: "Mixed sold and market comps found",
        desc:
          "Sello blended available sold comps with active market listings because sold data is still sparse.",
      };
    }
    if (summary.confidence !== "high") {
      return {
        variant: "warn" as const,
        title: "Sold comps need review",
        desc:
          "Sold comps were found, but match quality or price spread needs a seller review before trusting the recommendation.",
      };
    }
    return {
      variant: "info" as const,
      title: "Sold comps found",
      desc:
        "Review the recommendation and comp confidence before approving this listing.",
    };
  }
  return {
    variant: "info" as const,
    title: "No pricing data yet",
    desc:
      "Add a manual comp, or refresh to look for sold comps. Manual comps always work.",
  };
}
