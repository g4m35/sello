import { describe, expect, it } from "vitest";

import {
  canPublish,
  canTransition,
  describeState,
  LIFECYCLE_STATES,
  toLifecycleState,
} from "./item-status";

describe("toLifecycleState", () => {
  it("starts new items in draft", () => {
    expect(toLifecycleState("DRAFTING")).toBe("draft");
    expect(toLifecycleState("DRAFT_READY")).toBe("draft");
  });

  it("maps approval, failure, listing, sale, and delist statuses", () => {
    expect(toLifecycleState("APPROVED")).toBe("ready");
    expect(toLifecycleState("AI_FAILED")).toBe("error");
    expect(toLifecycleState("LISTED")).toBe("active");
    expect(toLifecycleState("LISTING")).toBe("active");
    expect(toLifecycleState("SOLD")).toBe("sold");
    expect(toLifecycleState("DELISTED")).toBe("delisted");
    expect(toLifecycleState("DELISTING")).toBe("delisted");
    expect(toLifecycleState("ARCHIVED")).toBe("delisted");
  });
});

describe("canTransition", () => {
  it("allows draft to become ready but not jump straight to sold", () => {
    expect(canTransition("draft", "ready")).toBe(true);
    expect(canTransition("draft", "sold")).toBe(false);
  });

  it("allows a ready item to be sold or delisted", () => {
    expect(canTransition("ready", "sold")).toBe(true);
    expect(canTransition("ready", "delisted")).toBe(true);
  });

  it("treats sold as terminal", () => {
    expect(canTransition("sold", "ready")).toBe(false);
    expect(canTransition("sold", "active")).toBe(false);
  });

  it("lets delisted and error items return to draft", () => {
    expect(canTransition("delisted", "draft")).toBe(true);
    expect(canTransition("error", "draft")).toBe(true);
  });
});

describe("canPublish", () => {
  it("only permits publishing-related actions when ready or active", () => {
    expect(canPublish("ready")).toBe(true);
    expect(canPublish("active")).toBe(true);
    expect(canPublish("draft")).toBe(false);
    expect(canPublish("sold")).toBe(false);
    expect(canPublish("delisted")).toBe(false);
    expect(canPublish("error")).toBe(false);
  });
});

describe("describeState", () => {
  it("provides a label and tone for every lifecycle state", () => {
    for (const state of LIFECYCLE_STATES) {
      const described = describeState(state);
      expect(described.label.length).toBeGreaterThan(0);
      expect(["neutral", "info", "positive", "warn", "danger"]).toContain(
        described.tone,
      );
    }
  });
});
