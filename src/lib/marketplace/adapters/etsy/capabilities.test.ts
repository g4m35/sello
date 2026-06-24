import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveEtsyCapabilities } from "./capabilities";

const user = { email: "seller@example.com" };

describe("resolveEtsyCapabilities (fails closed)", () => {
  it("keeps copy-ready on but all live capabilities off when the API is disabled", () => {
    const caps = resolveEtsyCapabilities(user, {
      ETSY_API_ENABLED: "false",
      ETSY_CONNECT_EMAILS: user.email,
      ETSY_PUBLISH_EMAILS: user.email,
      ETSY_DELIST_EMAILS: user.email,
      ETSY_ORDERS_EMAILS: user.email,
    });
    expect(caps).toEqual({
      copy: true,
      connect: false,
      publish: false,
      delist: false,
      orders: false,
    });
  });

  it("grants only the allowlisted capabilities when the API is enabled", () => {
    const caps = resolveEtsyCapabilities(user, {
      ETSY_API_ENABLED: "true",
      ETSY_CONNECT_EMAILS: user.email,
      ETSY_PUBLISH_EMAILS: "someone-else@example.com",
    });
    expect(caps.connect).toBe(true);
    expect(caps.publish).toBe(false);
    expect(caps.delist).toBe(false);
    expect(caps.copy).toBe(true);
  });

  it("denies a seller with no email", () => {
    const caps = resolveEtsyCapabilities(
      { email: null },
      { ETSY_API_ENABLED: "true", ETSY_CONNECT_EMAILS: "a@b.com" },
    );
    expect(caps.connect).toBe(false);
    expect(caps.publish).toBe(false);
  });
});
