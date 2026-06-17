import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMPS_REFRESH_COOLDOWN_MS,
  compsRefreshCooldownMs,
  evaluateRefreshCooldown,
} from "@/lib/comps/cooldown";

describe("compsRefreshCooldownMs", () => {
  it("defaults when unset or invalid", () => {
    expect(compsRefreshCooldownMs({})).toBe(DEFAULT_COMPS_REFRESH_COOLDOWN_MS);
    expect(compsRefreshCooldownMs({ COMPS_REFRESH_COOLDOWN_SECONDS: "abc" })).toBe(
      DEFAULT_COMPS_REFRESH_COOLDOWN_MS,
    );
  });
  it("reads an explicit value in seconds", () => {
    expect(compsRefreshCooldownMs({ COMPS_REFRESH_COOLDOWN_SECONDS: "30" })).toBe(30_000);
    expect(compsRefreshCooldownMs({ COMPS_REFRESH_COOLDOWN_SECONDS: "0" })).toBe(0);
  });
});

describe("evaluateRefreshCooldown", () => {
  const now = new Date("2026-06-17T12:00:00.000Z");

  it("allows when there is no prior run", () => {
    expect(evaluateRefreshCooldown({ lastRunAt: null, now, cooldownMs: 60_000 })).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("allows when the cooldown is disabled (0)", () => {
    expect(
      evaluateRefreshCooldown({ lastRunAt: now, now, cooldownMs: 0 }),
    ).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("blocks within the cooldown window and reports retry-after", () => {
    const lastRunAt = new Date(now.getTime() - 20_000);
    expect(
      evaluateRefreshCooldown({ lastRunAt, now, cooldownMs: 60_000 }),
    ).toEqual({ allowed: false, retryAfterSeconds: 40 });
  });

  it("allows once the window has elapsed", () => {
    const lastRunAt = new Date(now.getTime() - 61_000);
    expect(
      evaluateRefreshCooldown({ lastRunAt, now, cooldownMs: 60_000 }),
    ).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });
});
