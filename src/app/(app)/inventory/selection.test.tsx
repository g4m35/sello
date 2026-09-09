import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemView } from "@/lib/view/types";

const harness = vi.hoisted(() => ({ cursor: 0, states: [] as unknown[] }));
vi.mock("react", async (load) => ({
  ...await load<typeof import("react")>(),
  useEffect: () => {},
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.states)) harness.states[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [harness.states[index], (next: unknown) => { harness.states[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(harness.states[index]) : next; }];
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/providers/session-provider", () => ({ useSession: () => ({ token: "fixture" }) }));
vi.mock("@/components/providers/feature-access-provider", () => ({ useFeatureAccess: () => ({ access: {}, copy: {}, limits: { bulkBatchSize: 10 } }) }));
vi.mock("@/lib/api/client", () => ({ api: {} }));
import Inventory from "./page";

function find(node: ReactNode, predicate: (props: Record<string, unknown>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const hit = find(child, predicate); if (hit) return hit; } return; }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as ReactElement<Record<string, unknown>>;
  return predicate(element.props) ? element : find(element.props.children as ReactNode, predicate);
}
function render() { harness.cursor = 0; return Inventory(); }
function selectAll(tree: ReactNode) {
  const control = find(tree, (props) => props.label === "Select all items on this page");
  expect(control).toBeDefined();
  (control!.props.onChange as () => void)();
}

describe("inventory page selection", () => {
  beforeEach(() => {
    harness.cursor = 0;
    harness.states = [Array.from({ length: 30 }, (_, i) => ({ id: `item-${i}`, title: `Item ${i}`, productName: `Item ${i}`, category: "sneakers", condition: "used_good", brand: null, size: null, colorway: null, lifecycleState: "draft", ready: false, status: "draft", statusLabel: "Draft", channels: [], updatedAt: "2026-09-08T00:00:00Z", photoCount: 0, priceCents: null } as unknown as ItemView))];
  });
  it("selects the visible page only and preserves the first page when selecting a second", () => {
    selectAll(render());
    expect((harness.states[5] as Set<string>).size).toBe(24);
    const next = find(render(), (props) => props.children === "Next");
    (next!.props.onClick as () => void)();
    selectAll(render());
    expect((harness.states[5] as Set<string>).size).toBe(30);
    selectAll(render());
    expect((harness.states[5] as Set<string>).size).toBe(24);
  });
  it("keeps the selected count truthful when a search hides selected rows", () => {
    selectAll(render());
    const search = find(render(), (props) => props["aria-label"] === "Search inventory");
    (search!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Item 29" } });
    const tree = render();
    expect(find(tree, (props) => props.children === "24 selected")).toBeDefined();
    expect(find(tree, (props) => props.label === "Select all items on this page")?.props.checked).toBe(false);
  });
});
