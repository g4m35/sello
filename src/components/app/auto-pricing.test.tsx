import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getComps: vi.fn(),
  refreshComps: vi.fn(),
}));

const reactHarness = vi.hoisted(() => ({
  cursor: 0,
  states: [] as unknown[],
  effects: [] as Array<() => void | (() => void)>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      reactHarness.effects.push(effect);
    },
    useState: (initial: unknown) => {
      const index = reactHarness.cursor++;
      if (!(index in reactHarness.states)) {
        reactHarness.states[index] =
          typeof initial === "function" ? (initial as () => unknown)() : initial;
      }
      const setState = (next: unknown) => {
        reactHarness.states[index] =
          typeof next === "function"
            ? (next as (current: unknown) => unknown)(reactHarness.states[index])
            : next;
      };
      return [reactHarness.states[index], setState];
    },
  };
});

vi.mock("@/components/providers/session-provider", () => ({
  useSession: () => ({ token: "session-token" }),
}));

vi.mock("@/components/providers/feature-access-provider", () => ({
  useFeatureAccess: () => ({
    loading: false,
    access: { liveEbayPublish: false, ebayDelist: false, paidComps: true },
    copy: {
      liveEbayPublish: "Live publishing is unavailable.",
      ebayDelist: "Live delisting is unavailable.",
      paidComps: "Fresh sold comps are disabled.",
    },
  }),
}));

vi.mock("@/lib/api/client", () => ({
  api: {
    getComps: mocks.getComps,
    refreshComps: mocks.refreshComps,
    addComp: vi.fn(),
    updateComp: vi.fn(),
    deleteComp: vi.fn(),
  },
}));

import { AutoPricing } from "./auto-pricing";

function renderPricing() {
  reactHarness.cursor = 0;
  reactHarness.effects = [];
  return renderToStaticMarkup(<AutoPricing itemId="item-1" />);
}

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

describe("AutoPricing resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reactHarness.cursor = 0;
    reactHarness.states = [];
    reactHarness.effects = [];
  });

  it("keeps manual comps accessible when the comps GET request fails", async () => {
    mocks.getComps.mockRejectedValue({ error: "Could not load pricing safely." });

    renderPricing();
    expect(reactHarness.effects[0]).toBeTypeOf("function");
    reactHarness.effects[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    const html = renderPricing();
    expect(html).toContain("Could not load pricing safely.");
    expect(html).toContain("Add sold comp");
  });

  it("keeps manual comps accessible and shows safe panel copy when refresh fails", async () => {
    mocks.getComps.mockResolvedValue({
      summary: {
        status: "needs_comps",
        totalComps: 0,
        validComps: 0,
        lowCents: null,
        averageCents: null,
        highCents: null,
        quickSaleCents: null,
        recommendedListCents: null,
        confidence: "none",
      },
      discovery: {
        status: "disabled",
        autoDiscoveryEnabled: false,
        paidProvidersEnabled: false,
        enabledSources: [],
        queries: [],
        sourceErrors: [],
        lastRunAt: null,
      },
      comps: [],
    });
    mocks.refreshComps.mockRejectedValue({
      error: "Fresh sold comps are disabled right now. Manual comps still work.",
    });

    renderPricing();
    reactHarness.effects[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    reactHarness.cursor = 0;
    reactHarness.effects = [];
    const readyView = AutoPricing({ itemId: "item-1" });
    const refresh = findElement(
      readyView,
      (element) => element.props.children === "Refresh comps",
    );
    expect(refresh).not.toBeNull();
    await (refresh?.props.onClick as () => Promise<void>)();

    const html = renderPricing();
    expect(html).toContain("Fresh sold comps are disabled right now. Manual comps still work.");
    expect(html).toContain("Add sold comp");
  });
});
