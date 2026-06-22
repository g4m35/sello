import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  listItems: vi.fn(),
  getChannels: vi.fn(),
}));

const reactHarness = vi.hoisted(() => ({
  cursor: 0,
  states: [] as unknown[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: () => {},
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

vi.mock("next/navigation", () => ({
  usePathname: () => "/inventory",
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/components/providers/session-provider", () => ({
  useSession: () => ({
    session: { user: { email: "owner@example.com" } },
    token: "t",
    signOut: vi.fn(),
    name: "Owner",
    requestNameEdit: vi.fn(),
  }),
}));

vi.mock("@/lib/api/client", () => ({
  api: { listItems: mocks.listItems, getChannels: mocks.getChannels },
}));

vi.mock("@/components/app/theme-toggle", () => ({ ThemeToggle: () => null }));

import { Sidebar } from "./sidebar";

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | null {
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const element = node as ReactElement<Record<string, unknown>>;
  if (predicate(element)) return element;
  const children = element.props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child as ReactNode, predicate);
    if (found) return found;
  }
  return null;
}

describe("Sidebar brand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reactHarness.cursor = 0;
    reactHarness.states = [];
  });

  it("navigates to the dashboard when the Sello logo is clicked", () => {
    reactHarness.cursor = 0;
    const tree = Sidebar();
    const brand = findElement(
      tree,
      (el) => el.props["aria-label"] === "Sello — go to dashboard",
    );
    expect(brand).not.toBeNull();
    (brand?.props.onClick as () => void)();
    expect(mocks.push).toHaveBeenCalledWith("/dashboard");
  });
});
