import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({ cursor: 0, states: [] as unknown[] }));
vi.mock("react", async (load) => ({ ...await load<typeof import("react")>(),
  useState: (initial: unknown) => { const i = harness.cursor++; return [i in harness.states ? harness.states[i] : initial, vi.fn()]; },
  useEffect: () => {}, useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(), useRef: (value: unknown) => ({ current: value }),
}));
vi.mock("@/components/app/topbar", () => ({ Topbar: () => null }));
vi.mock("./stockx-card", () => ({ StockXConnectionCard: () => null }));
vi.mock("./etsy-card", () => ({ EtsyConnectionCard: () => null }));
vi.mock("./connection-controls", () => ({ ConnectionControls: ({ name }: { name: string }) => <button>Manage {name} connection</button> }));
vi.mock("@/lib/supabase/browser", () => ({ getBrowserSupabase: () => ({}), consumeSupabaseImplicitSessionFromUrl: vi.fn() }));
import MarketplaceSettingsPage from "./page";
const readiness = { connected: true, ready: true, environment: "production", reconnectRequired: false, missing: [], checkedAt: "2026-09-23T00:00:00Z", salesReadPermission: null };
function render() { harness.cursor = 0; return renderToStaticMarkup(MarketplaceSettingsPage()); }
describe("original marketplace presentation with corrected connection semantics", () => {
  beforeEach(() => { harness.states = [{ access_token: "fixture" }, readiness, "ready", "idle", null, null]; });
  it("restores the original separate card header while retaining unknown sales access and safe account controls", () => {
    const html = render();
    expect(html).toContain('class="card"');
    expect(html).toContain('class="card__head"');
    expect(html).not.toContain('class="connection');
    expect(html).toContain("Production account");
    expect(html).toContain(">Connected</p>");
    expect(html).toContain("Sales access: Not verified");
    expect(html).toContain("Reconnect eBay");
    expect(html).toContain("Manage eBay connection");
    expect(html).not.toContain("Connected · ready");
  });
  it("keeps confirmed permissions distinct from unverified and missing permissions", () => {
    harness.states[1] = { ...readiness, salesReadPermission: true };
    expect(render()).toContain("Sales access: Granted");
    expect(render()).not.toContain("Reconnect eBay");
    harness.states[1] = { ...readiness, salesReadPermission: false };
    expect(render()).toContain("Sales access: Permission needed");
    expect(render()).toContain("sales access is missing");
  });
  it("does not offer connect while initial status is loading", () => {
    harness.states[1] = null; harness.states[2] = "loading";
    const html = render();
    expect(html).toContain("Checking connection");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Connect eBay</button>");
  });
  it("retains error feedback and retry without advertising unavailable status as connected", () => {
    harness.states[2] = "error"; harness.states[4] = "Could not load eBay status.";
    const html = render();
    expect(html).toContain("Status unavailable");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
    expect(html).not.toContain(">Connected</p>");
  });
});
