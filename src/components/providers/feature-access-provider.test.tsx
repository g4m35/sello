import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFeatureAccess: vi.fn(),
  useSession: vi.fn(() => ({ token: "session-token" })),
}));

const reactHarness = vi.hoisted(() => ({
  context: null as null | { current: unknown },
  effect: null as null | (() => void | (() => void)),
  state: undefined as unknown,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    createContext: (initial: unknown) => {
      const context = {
        current: initial,
        Provider: ({ value, children }: { value: unknown; children: unknown }) => {
          context.current = value;
          return children;
        },
      };
      reactHarness.context = context;
      return context;
    },
    useContext: (context: { current: unknown }) => context.current,
    useEffect: (effect: () => void | (() => void)) => {
      reactHarness.effect = effect;
    },
    useState: (initial: unknown) => {
      if (reactHarness.state === undefined) {
        reactHarness.state =
          typeof initial === "function" ? (initial as () => unknown)() : initial;
      }
      const setState = (next: unknown) => {
        reactHarness.state =
          typeof next === "function"
            ? (next as (current: unknown) => unknown)(reactHarness.state)
            : next;
      };
      return [reactHarness.state, setState];
    },
  };
});

vi.mock("@/lib/api/client", () => ({
  api: { getFeatureAccess: mocks.getFeatureAccess },
}));
vi.mock("./session-provider", () => ({ useSession: mocks.useSession }));

import {
  FeatureAccessProvider,
  useFeatureAccess,
} from "./feature-access-provider";

const safeCopy = {
  liveEbayPublish:
    "Live eBay publishing is currently enabled for selected alpha accounts.",
  ebayDelist:
    "Live eBay delisting is currently enabled for selected alpha accounts.",
  paidComps:
    "Fresh sold comps are currently enabled for selected alpha accounts.",
  etsyConnect:
    "Connecting an Etsy shop is currently enabled for selected alpha accounts.",
  etsyPublish:
    "Live Etsy publishing is currently enabled for selected alpha accounts.",
  etsyDelist:
    "Live Etsy delisting is currently enabled for selected alpha accounts.",
  etsyOrders:
    "Etsy order sync is currently enabled for selected alpha accounts.",
};

const deniedAccess = {
  liveEbayPublish: false,
  ebayDelist: false,
  paidComps: false,
  etsyConnect: false,
  etsyPublish: false,
  etsyDelist: false,
  etsyOrders: false,
};

const freeLimits = {
  aiListingsPerMonth: 10,
  autopublishesPerMonth: 10,
  compRefreshesPerMonth: 10,
  marketplaceConnections: 1,
  bulkBatchSize: 5,
  teamSeats: 1,
};

const proLimits = {
  aiListingsPerMonth: 125,
  autopublishesPerMonth: 125,
  compRefreshesPerMonth: 100,
  marketplaceConnections: 3,
  bulkBatchSize: 25,
  teamSeats: 1,
};

function renderProvider() {
  const element = FeatureAccessProvider({ children: "child" }) as ReactElement<{
    value: unknown;
    children: unknown;
  }>;
  const Provider = element.type as (props: {
    value: unknown;
    children: unknown;
  }) => unknown;
  Provider(element.props);
}

async function runEffect() {
  expect(reactHarness.effect).toBeTypeOf("function");
  reactHarness.effect?.();
  await Promise.resolve();
  await Promise.resolve();
}

describe("FeatureAccessProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    reactHarness.effect = null;
    reactHarness.state = undefined;
  });

  it("exposes loading and then the authenticated API response without client env access", async () => {
    vi.stubEnv("NEXT_PUBLIC_LIVE_EBAY_PUBLISH_EMAILS", "wrong@example.com");
    mocks.getFeatureAccess.mockResolvedValue({
      access: {
        liveEbayPublish: true,
        ebayDelist: false,
        paidComps: true,
      },
      copy: safeCopy,
      plan: "pro",
      limits: proLimits,
    });

    renderProvider();
    expect(useFeatureAccess()).toEqual({
      loading: true,
      access: deniedAccess,
      copy: safeCopy,
      plan: "free",
      limits: freeLimits,
    });

    await runEffect();
    renderProvider();

    expect(mocks.getFeatureAccess).toHaveBeenCalledWith("session-token");
    expect(useFeatureAccess()).toEqual({
      loading: false,
      access: {
        liveEbayPublish: true,
        ebayDelist: false,
        paidComps: true,
      },
      copy: safeCopy,
      plan: "pro",
      limits: proLimits,
    });
  });

  it("fails closed while retaining safe copy when the API request fails", async () => {
    mocks.getFeatureAccess.mockRejectedValue(new Error("network unavailable"));

    renderProvider();
    await runEffect();
    renderProvider();

    expect(useFeatureAccess()).toEqual({
      loading: false,
      access: deniedAccess,
      copy: safeCopy,
      plan: "free",
      limits: freeLimits,
    });
  });
});
