import { afterEach, describe, expect, it, vi } from "vitest";

import { assertBulkIntakeEnabled, isBulkIntakeEnabled } from "./config";

afterEach(() => vi.unstubAllEnvs());

describe("bulk intake kill switch", () => {
  it("defaults off when the environment variable is absent", () => {
    vi.stubEnv("BULK_INTAKE_ENABLED", "");

    expect(isBulkIntakeEnabled()).toBe(false);
    expect(() => assertBulkIntakeEnabled()).toThrowError(
      expect.objectContaining({ status: 503, code: "BULK_INTAKE_DISABLED" }),
    );
  });

  it("only enables new work for an explicit true value", () => {
    vi.stubEnv("BULK_INTAKE_ENABLED", "true");

    expect(isBulkIntakeEnabled()).toBe(true);
    expect(() => assertBulkIntakeEnabled()).not.toThrow();
  });
});
