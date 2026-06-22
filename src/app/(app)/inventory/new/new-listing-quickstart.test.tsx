import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reactHarness = vi.hoisted(() => ({
  cursor: 0,
  states: [] as unknown[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: () => {},
    useRef: () => ({ current: null }),
    useCallback: (fn: unknown) => fn,
    useState: (initial: unknown) => {
      const index = reactHarness.cursor++;
      if (!(index in reactHarness.states)) {
        reactHarness.states[index] =
          typeof initial === "function" ? (initial as () => unknown)() : initial;
      }
      return [reactHarness.states[index], () => {}];
    },
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/providers/session-provider", () => ({
  useSession: () => ({ token: "t" }),
}));
vi.mock("@/lib/api/client", () => ({ api: { getChannels: vi.fn() } }));

import NewListingPage from "./page";

function collectStrings(node: ReactNode, out: string[]): void {
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, out);
    return;
  }
  if (typeof node === "object" && "props" in node) {
    collectStrings((node as ReactElement<{ children?: ReactNode }>).props.children, out);
  }
}

describe("new listing quickstart", () => {
  beforeEach(() => {
    reactHarness.cursor = 0;
    reactHarness.states = [];
  });

  it("offers upload but no Import CSV in the core seller flow", () => {
    reactHarness.cursor = 0;
    const tree = NewListingPage();
    const strings: string[] = [];
    collectStrings(tree, strings);
    const text = strings.join(" ");
    expect(text).toContain("Upload photos");
    expect(text).not.toMatch(/import csv/i);
  });
});
