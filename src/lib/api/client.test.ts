import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./client";

describe("API client read timeouts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects a stalled listing request with safe retry copy", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    const request = api.getItem("session-token", "item-1").then(
      () => "resolved",
      (error) => error,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    const outcome = await Promise.race([request, Promise.resolve("still-pending")]);

    expect(outcome).toEqual({
      error: "The request took too long. Please try again.",
      status: 408,
    });
  });
});
