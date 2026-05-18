import { describe, expect, it } from "vitest";

import { LifecycleRequestSchema } from "./lifecycle-request";

describe("LifecycleRequestSchema", () => {
  it("accepts a supported action with a uuid item id", () => {
    const parsed = LifecycleRequestSchema.parse({
      inventoryItemId: "3f1d2c4e-5a6b-4c8d-9e0f-1a2b3c4d5e6f",
      action: "delist",
    });

    expect(parsed.action).toBe("delist");
  });

  it("rejects unsupported lifecycle actions", () => {
    expect(() =>
      LifecycleRequestSchema.parse({
        inventoryItemId: "3f1d2c4e-5a6b-4c8d-9e0f-1a2b3c4d5e6f",
        action: "publish",
      }),
    ).toThrow();
  });
});
