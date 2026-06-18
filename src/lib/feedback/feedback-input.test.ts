import { describe, expect, it } from "vitest";

import { CreateFeedbackSchema, UpdateFeedbackSchema } from "@/lib/feedback/feedback-input";

const valid = {
  type: "bug" as const,
  severity: "high" as const,
  subject: "Pricing panel crashed",
  message: "Clicking refresh threw an error.",
};

describe("CreateFeedbackSchema", () => {
  it("accepts a valid submission and defaults severity", () => {
    const parsed = CreateFeedbackSchema.parse({ type: "other", subject: "Hi", message: "There" });
    expect(parsed.severity).toBe("medium");
  });

  it("accepts optional marketplace + references", () => {
    const parsed = CreateFeedbackSchema.parse({
      ...valid,
      marketplace: "grailed",
      pageUrl: "/inventory/abc",
    });
    expect(parsed.marketplace).toBe("grailed");
  });

  it("rejects an unknown type", () => {
    expect(CreateFeedbackSchema.safeParse({ ...valid, type: "spam" }).success).toBe(false);
  });

  it("rejects an empty or over-long subject", () => {
    expect(CreateFeedbackSchema.safeParse({ ...valid, subject: "" }).success).toBe(false);
    expect(CreateFeedbackSchema.safeParse({ ...valid, subject: "x".repeat(201) }).success).toBe(false);
  });

  it("rejects an empty or over-long message", () => {
    expect(CreateFeedbackSchema.safeParse({ ...valid, message: "" }).success).toBe(false);
    expect(CreateFeedbackSchema.safeParse({ ...valid, message: "x".repeat(5001) }).success).toBe(false);
  });

  it("rejects a non-uuid listingId", () => {
    expect(CreateFeedbackSchema.safeParse({ ...valid, listingId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects a client-supplied userId/status (strict schema, never trusted)", () => {
    expect(
      CreateFeedbackSchema.safeParse({ ...valid, userId: "attacker" }).success,
    ).toBe(false);
    expect(
      CreateFeedbackSchema.safeParse({ ...valid, status: "resolved" }).success,
    ).toBe(false);
  });
});

describe("UpdateFeedbackSchema", () => {
  it("accepts a status change", () => {
    expect(UpdateFeedbackSchema.parse({ status: "resolved" }).status).toBe("resolved");
  });
  it("rejects an empty update", () => {
    expect(UpdateFeedbackSchema.safeParse({}).success).toBe(false);
  });
  it("rejects an unknown status", () => {
    expect(UpdateFeedbackSchema.safeParse({ status: "spam" }).success).toBe(false);
  });
});
