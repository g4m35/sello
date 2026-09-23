import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({ cursor: 0, states: [] as unknown[], resolve: vi.fn() }));
vi.mock("react", async (load) => ({ ...await load<typeof import("react")>(), useEffect: () => {}, useCallback: (fn: unknown) => fn,
  useState: (initial: unknown) => { const i = harness.cursor++; if (!(i in harness.states)) harness.states[i] = initial; return [harness.states[i], (next: unknown) => { harness.states[i] = typeof next === "function" ? (next as (v: unknown) => unknown)(harness.states[i]) : next; }]; },
}));
vi.mock("@/lib/api/client", () => ({ api: { resolveInventoryReviewTask: harness.resolve } }));
import { InventoryAttention } from "./inventory-attention";
function find(node: ReactNode, label: string): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const result = find(child, label); if (result) return result; } return; }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const el = node as ReactElement<Record<string, unknown>>;
  return el.props.children === label ? el : find(el.props.children as ReactNode, label);
}
const task = { id: "task-1", type: "manual_delist_required", title: "Remove listing" };
const resolved = vi.fn();
function render() { harness.cursor = 0; return InventoryAttention({ token: "account-token", onResolved: resolved }); }
describe("attention task resolution", () => {
  beforeEach(() => { harness.states = [[task], [], [], false, 0, { task, status: "resolved" }, false, ""]; harness.resolve.mockReset(); resolved.mockReset(); });
  it("uses the scoped API and removes a task only after confirmed success", async () => {
    harness.resolve.mockResolvedValue({ ok: true });
    (find(render(), "Confirm removed")!.props.onClick as () => void)();
    await vi.waitFor(() => expect(resolved).toHaveBeenCalledOnce());
    expect(harness.resolve).toHaveBeenCalledWith("account-token", "task-1", "resolved");
    expect(harness.states[0]).toEqual([]);
    expect(harness.states[5]).toBeNull();
  });
  it("retains a failed task and its modal so the error cannot be mistaken for completion", async () => {
    harness.resolve.mockRejectedValue({ error: "The task could not be saved." });
    (find(render(), "Confirm removed")!.props.onClick as () => void)();
    await vi.waitFor(() => expect(harness.states[7]).toBe("The task could not be saved."));
    expect(harness.states[0]).toEqual([task]);
    expect(harness.states[5]).not.toBeNull();
    expect(resolved).not.toHaveBeenCalled();
  });
});
