import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({ cursor: 0, states: [] as unknown[], retry: vi.fn() }));
vi.mock("react", async (load) => ({ ...await load<typeof import("react")>(), useEffect: () => {}, useRef: (value: unknown) => ({ current: value }),
  useState: (initial: unknown) => { const i = harness.cursor++; if (!(i in harness.states)) harness.states[i] = initial; return [harness.states[i], (next: unknown) => { harness.states[i] = typeof next === "function" ? (next as (v: unknown) => unknown)(harness.states[i]) : next; }]; },
}));
vi.mock("@/lib/api/client", () => ({ api: { retryListingPreparation: harness.retry } }));
import { ListingAutomationStatus } from "./listing-automation-status";
function find(node: ReactNode, label: string): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const result = find(child, label); if (result) return result; } return; }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const el = node as ReactElement<Record<string, unknown>>;
  return el.props.children === label ? el : find(el.props.children as ReactNode, label);
}
function render() { harness.cursor = 0; return ListingAutomationStatus({ token: "account-token", itemId: "item", onComplete: vi.fn() }); }
describe("preparation recovery", () => {
  beforeEach(() => { harness.states = [{ status: "FAILED", message: "Pricing failed", recoveryAction: "retry_preparation" }, false, false, "", 0]; harness.retry.mockReset(); });
  it("does not offer recovery for ambiguous publication", () => {
    harness.states[0] = { status: "FAILED", message: "Check marketplace activity", recoveryAction: null };
    expect(find(render(), "Retry preparation")).toBeUndefined();
  });
  it("explains no publishing and starts polling the accepted preparation job", async () => {
    const job = { status: "QUEUED", message: "Checking pricing", recoveryAction: null };
    harness.retry.mockResolvedValue({ job });
    const tree = render();
    expect(find(tree, "Retry identification checks and pricing. This will not publish your listing.")).toBeDefined();
    (find(tree, "Retry preparation")!.props.onClick as () => void)();
    await vi.waitFor(() => expect(harness.states[4]).toBe(1));
    expect(harness.states[0]).toEqual(job);
    expect(harness.retry).toHaveBeenCalledWith("account-token", "item");
  });
  it("leaves the failed status intact when the recovery request fails", async () => {
    harness.retry.mockRejectedValue({ error: "Review publication before retrying." });
    (find(render(), "Retry preparation")!.props.onClick as () => void)();
    await vi.waitFor(() => expect(harness.states[3]).toBe("Review publication before retrying."));
    expect(harness.states[4]).toBe(0);
    expect(harness.states[0]).toMatchObject({ status: "FAILED" });
  });
});
