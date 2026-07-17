import { describe, expect, it } from "vitest";

import {
  MARKETPLACE_REGISTRY,
  getMarketplaceDescriptor,
  isPublishQueueEligible,
  listMarketplaceDescriptors,
  listPublishQueueEligibleMarketplaces,
  resolveCurrentCapabilities,
} from "./registry";

describe("marketplace registry", () => {
  it("describes every marketplace enum value, including the three new ones", () => {
    const keys = listMarketplaceDescriptors()
      .map((d) => d.key)
      .sort();
    expect(keys).toEqual(
      [
        "depop",
        "ebay",
        "etsy",
        "grailed",
        "mercari",
        "poshmark",
        "stockx",
        "tiktok_shop",
        "vinted",
      ].sort(),
    );
  });

  it("each descriptor exposes a display name, integration mode and UI copy", () => {
    for (const descriptor of listMarketplaceDescriptors()) {
      expect(descriptor.displayName.length).toBeGreaterThan(0);
      expect(descriptor.uiCopy.length).toBeGreaterThan(0);
      expect(descriptor.bestFutureMode.length).toBeGreaterThan(0);
    }
  });

  describe("mercari", () => {
    const mercari = getMarketplaceDescriptor("mercari");

    it("is an assisted copy-ready channel (no official listing API)", () => {
      expect(mercari.displayName).toBe("Mercari");
      expect(mercari.integrationMode).toBe("assisted");
      expect(mercari.defaultStatus).toBe("copy_ready");
      expect(mercari.fallbackMode).toBe("copy_ready");
      expect(mercari.capabilities.canCreateDraft).toBe(true);
      expect(mercari.capabilities.canAutoPublish).toBe(false);
    });

    it("fails closed: no current capabilities without a live adapter", () => {
      const current = resolveCurrentCapabilities(mercari, {
        enabled: true,
        connected: true,
        implemented: false,
      });
      expect(current.canCreateDraft).toBe(false);
      expect(current.canAutoPublish).toBe(false);
    });
  });

  describe("vinted", () => {
    const vinted = getMarketplaceDescriptor("vinted");

    it("is a gated scaffold that requires Pro access by default", () => {
      expect(vinted.integrationMode).toBe("gated_scaffold");
      expect(vinted.defaultStatus).toBe("access_required");
      expect(vinted.bestFutureMode).toContain("Vinted Pro");
      // copy_ready is the only fallback the export layer actually implements.
      expect(vinted.fallbackMode).toBe("copy_ready");
      expect(vinted.uiCopy).toContain("Vinted Pro API access required");
    });

    it("advertises the full Pro capability ceiling", () => {
      expect(vinted.capabilities).toMatchObject({
        canAutoPublish: true,
        canUpdateListing: true,
        canDeleteListing: true,
        canSyncInventory: true,
        canReceiveSoldWebhook: true,
        requiresBusinessAccount: true,
        requiresManualApproval: true,
      });
    });

    it("fails closed: current capabilities are all false until Pro access is connected", () => {
      const current = resolveCurrentCapabilities(vinted, {
        enabled: false,
        connected: false,
        implemented: false,
      });
      expect(current.canAutoPublish).toBe(false);
      expect(current.canUpdateListing).toBe(false);
      expect(current.canDeleteListing).toBe(false);
      expect(current.canSyncInventory).toBe(false);
      expect(current.canReceiveSoldWebhook).toBe(false);
      // Requirement descriptors are preserved (they describe what is needed).
      expect(current.requiresManualApproval).toBe(true);
    });

    it("stays fail-closed even if a connection is forced, because no live adapter is implemented", () => {
      const current = resolveCurrentCapabilities(vinted, {
        enabled: true,
        connected: true,
        implemented: false,
      });
      expect(current.canAutoPublish).toBe(false);
    });
  });

  describe("stockx", () => {
    const stockx = getMarketplaceDescriptor("stockx");

    it("is a full-native API channel that still requires an exact catalog match", () => {
      expect(stockx.integrationMode).toBe("full_native");
      expect(stockx.defaultStatus).toBe("catalog_match_required");
      expect(stockx.capabilities.requiresCatalogMatch).toBe(true);
      expect(stockx.capabilities.requiresManualApproval).toBe(true);
      expect(stockx.uiCopy).toContain("exact catalog match");
      // Catalog-driven listing has no meaningful paste text, so no fallback.
      expect(stockx.fallbackMode).toBeNull();
    });

    it("does not advertise a sold webhook (none is implemented)", () => {
      expect(stockx.capabilities.canReceiveSoldWebhook).toBe(false);
    });

    it("advertises StockX listing creation and deactivation but not sold webhook automation", () => {
      expect(stockx.capabilities.canAutoPublish).toBe(true);
      expect(stockx.capabilities.canUpdateListing).toBe(false);
      expect(stockx.capabilities.canDeleteListing).toBe(true);
      expect(stockx.capabilities.canSyncInventory).toBe(true);
      expect(stockx.capabilities.canCreateDraft).toBe(true);
      expect(stockx.uiCopy).toContain("official API");
    });

    it("never auto-publishes without an exact catalog match and a real implementation", () => {
      const noMatch = resolveCurrentCapabilities(stockx, {
        enabled: true,
        connected: true,
        implemented: true,
        catalogMatched: false,
      });
      expect(noMatch.canAutoPublish).toBe(false);

      const notImplemented = resolveCurrentCapabilities(stockx, {
        enabled: true,
        connected: true,
        implemented: false,
        catalogMatched: true,
      });
      expect(notImplemented.canAutoPublish).toBe(false);

      const ready = resolveCurrentCapabilities(stockx, {
        enabled: true,
        connected: true,
        implemented: true,
        catalogMatched: true,
      });
      expect(ready.canAutoPublish).toBe(true);
    });
  });

  describe("tiktok_shop", () => {
    const tiktok = getMarketplaceDescriptor("tiktok_shop");

    it("is a gated scaffold (no live handler yet) that requires a connected shop", () => {
      // Ceiling stays full-native-shaped, but until a real TikTok Shop handler
      // exists the integration mode must keep it out of the publish queue.
      expect(tiktok.integrationMode).toBe("gated_scaffold");
      expect(tiktok.defaultStatus).toBe("shop_connection_required");
      expect(tiktok.capabilities).toMatchObject({
        canAutoPublish: true,
        canCreateDraft: true,
        canUpdateListing: true,
        canDeleteListing: true,
        canSyncInventory: true,
        canReceiveSoldWebhook: true,
        requiresBusinessAccount: true,
        requiresManualApproval: true,
        requiresShopConnection: true,
        requiresRequiredProductFields: true,
        mayRequirePlatformAudit: true,
      });
      expect(tiktok.uiCopy).toContain("connected seller shop");
    });

    it("fails closed when the shop is not connected", () => {
      const current = resolveCurrentCapabilities(tiktok, {
        enabled: true,
        connected: true,
        implemented: true,
        shopConnected: false,
      });
      expect(current.canAutoPublish).toBe(false);
      expect(current.canUpdateListing).toBe(false);
    });

    it("fails closed when the integration is disabled even with a connected shop", () => {
      const current = resolveCurrentCapabilities(tiktok, {
        enabled: false,
        connected: true,
        implemented: true,
        shopConnected: true,
      });
      expect(current.canAutoPublish).toBe(false);
    });

    it("reaches full autonomy only when enabled, connected, implemented and shop-connected", () => {
      const current = resolveCurrentCapabilities(tiktok, {
        enabled: true,
        connected: true,
        implemented: true,
        shopConnected: true,
      });
      expect(current.canAutoPublish).toBe(true);
      expect(current.canCreateDraft).toBe(true);
      expect(current.canUpdateListing).toBe(true);
      expect(current.canDeleteListing).toBe(true);
      expect(current.canSyncInventory).toBe(true);
      expect(current.canReceiveSoldWebhook).toBe(true);
    });
  });

  it("keeps the existing marketplaces represented (no regression)", () => {
    expect(MARKETPLACE_REGISTRY.ebay.displayName).toBe("eBay");
    expect(MARKETPLACE_REGISTRY.etsy.displayName).toBe("Etsy");
    expect(MARKETPLACE_REGISTRY.grailed.displayName).toBe("Grailed");
    expect(MARKETPLACE_REGISTRY.poshmark.displayName).toBe("Poshmark");
    expect(MARKETPLACE_REGISTRY.depop.displayName).toBe("Depop");
  });

  it("keeps eBay and Etsy as full-native channels with unchanged capability ceilings", () => {
    expect(MARKETPLACE_REGISTRY.ebay.integrationMode).toBe("full_native");
    expect(MARKETPLACE_REGISTRY.ebay.capabilities.canAutoPublish).toBe(true);
    expect(MARKETPLACE_REGISTRY.etsy.integrationMode).toBe("full_native");
    expect(MARKETPLACE_REGISTRY.etsy.capabilities.canAutoPublish).toBe(true);
    expect(MARKETPLACE_REGISTRY.etsy.capabilities.canSyncInventory).toBe(true);
  });

  describe("publish-queue eligibility (fail closed at enqueue)", () => {
    it("rejects channels that cannot safely run in the background queue yet", () => {
      expect(isPublishQueueEligible("vinted")).toBe(false);
      // No live TikTok Shop handler exists; the queue must fail closed.
      expect(isPublishQueueEligible("tiktok_shop")).toBe(false);
    });

    it("allows full-native and assisted channels into the publish queue", () => {
      for (const mp of [
        "ebay",
        "etsy",
        "grailed",
        "poshmark",
        "depop",
        "mercari",
        "stockx",
      ] as const) {
        expect(isPublishQueueEligible(mp)).toBe(true);
      }
    });

    it("lists exactly the publish-queue-eligible marketplaces", () => {
      expect(listPublishQueueEligibleMarketplaces().sort()).toEqual(
        ["depop", "ebay", "etsy", "grailed", "mercari", "poshmark", "stockx"].sort(),
      );
    });
  });
});
