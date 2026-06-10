import type { EbayReadinessResponse } from "@/lib/marketplace/adapters/ebay/types";

export const ebayReadinessLabels = {
  oauth_connection: "OAuth connection",
  payment_policy: "Payment policy",
  fulfillment_policy: "Fulfillment policy",
  return_policy: "Return policy",
  inventory_location: "Inventory location",
} as const;

export const ebayReadinessHelp = {
  oauth_connection: "Connect your eBay account so Sello can check seller setup.",
  payment_policy:
    "Create a payment policy that tells eBay how buyer payment is handled for listings.",
  fulfillment_policy:
    "Create a fulfillment policy with the shipping services, handling time, and shipping costs buyers will see.",
  return_policy:
    "Create a return policy that states whether returns are accepted and under what terms.",
  inventory_location:
    "Create and enable an inventory location that tells eBay where your inventory ships from.",
} as const;

export const ebayReadinessItems = [
  "oauth_connection",
  "payment_policy",
  "fulfillment_policy",
  "return_policy",
  "inventory_location",
] as const;

export type EbayReadinessItem = (typeof ebayReadinessItems)[number];

export function getEbaySetupMessage(readiness: EbayReadinessResponse | null) {
  if (readiness?.reconnectRequired) {
    return {
      heading: "Reconnect eBay",
      body: "Your eBay connection has expired or was revoked. Reconnect your eBay account to continue.",
    };
  }

  if (!readiness?.connected) {
    return {
      heading: "Connect eBay",
      body: "Connect your eBay account before Sello can check seller setup.",
    };
  }

  if (readiness.ready) {
    return {
      heading: "Connected",
      body:
        readiness.environment === "production"
          ? "Your eBay account setup is ready. Production publishing remains disabled until it is deliberately enabled."
          : "Your eBay sandbox account setup is ready for guarded sandbox publishing.",
    };
  }

  return {
    heading: "Setup required before publishing",
    body:
      "Connected. Sello still needs eBay business policies and an enabled inventory location before publishing can be enabled.",
  };
}

export function getEbayActionModel(
  readiness: EbayReadinessResponse | null,
  connectLabel = "Connect eBay",
) {
  const connected = Boolean(readiness?.connected);

  return {
    showPrimaryConnect: !connected,
    showSecondaryReconnect: connected,
    primaryConnectLabel: connectLabel,
    secondaryReconnectLabel: connectLabel.replace(/^Connect/, "Reconnect"),
  };
}

export function shouldAutoRefreshEbayReadiness(
  readiness: EbayReadinessResponse | null,
  attempted: boolean,
) {
  return Boolean(readiness?.connected && !readiness.checkedAt && !attempted);
}
