import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({
    data: { subscription: { unsubscribe: vi.fn() } },
  })),
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
    useMemo: (factory: () => unknown) => factory(),
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

vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
    },
  }),
}));

import { SessionProvider } from "./session-provider";

function renderProvider() {
  reactHarness.cursor = 0;
  reactHarness.effects = [];
  return renderToStaticMarkup(<SessionProvider>workspace</SessionProvider>);
}

describe("SessionProvider bootstrap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    reactHarness.cursor = 0;
    reactHarness.states = [];
    reactHarness.effects = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves the loading shell and shows a safe auth retry state when session loading stalls", async () => {
    mocks.getSession.mockReturnValue(new Promise(() => {}));

    expect(renderProvider()).not.toContain("Retry session");
    expect(reactHarness.effects[0]).toBeTypeOf("function");
    reactHarness.effects[0]?.();

    await vi.advanceTimersByTimeAsync(15_000);
    const html = renderProvider();

    expect(html).toContain("We couldn&#x27;t verify your session");
    expect(html).toContain("Retry session");
  });
});
