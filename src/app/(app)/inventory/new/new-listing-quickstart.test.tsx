import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reactHarness = vi.hoisted(() => ({
  cursor: 0,
  states: [] as unknown[],
}));
const apiMocks = vi.hoisted(() => ({ createDraftFromPhotos: vi.fn(), push: vi.fn() }));

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

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: apiMocks.push }) }));
vi.mock("@/components/providers/session-provider", () => ({
  useSession: () => ({ token: "t" }),
}));
vi.mock("@/lib/api/client", () => ({ api: { getChannels: vi.fn(), createDraftFromPhotos: apiMocks.createDraftFromPhotos } }));

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

function findPrepareButton(node: ReactNode): ReactElement<{ onClick: () => void }> | undefined {
  if (Array.isArray(node)) return node.map(findPrepareButton).find(Boolean);
  if (node && typeof node === "object" && "props" in node) {
    const element = node as ReactElement<{ variant?: string; onClick: () => void; children?: ReactNode }>;
    if (element.props.variant === "accent") return element;
    return findPrepareButton(element.props.children);
  }
}

describe("new listing quickstart", () => {
  beforeEach(() => {
    reactHarness.cursor = 0;
    reactHarness.states = [];
    vi.clearAllMocks();
    apiMocks.createDraftFromPhotos.mockResolvedValue({ inventoryItem: { id: "created-item" } });
  });

  it("offers upload but no Import CSV in the core seller flow", () => {
    reactHarness.cursor = 0;
    const tree = NewListingPage();
    const strings: string[] = [];
    collectStrings(tree, strings);
    const text = strings.join(" ");
    expect(text).toContain("Upload photos");
    expect(text).toContain("Drop 1 to 3 photos or click to choose");
    expect(text).toContain("Nothing is published automatically.");
    expect(text).not.toMatch(/import csv/i);
  });
  it("keeps preparation-only as the default in the restored form", async () => {
    const file = new File(["photo"], "item.jpg", { type: "image/jpeg" });
    reactHarness.states[0] = [{ file, url: "blob:photo" }];
    findPrepareButton(NewListingPage())!.props.onClick();
    await vi.waitFor(() => expect(apiMocks.createDraftFromPhotos).toHaveBeenCalledWith("t", [file], { mode: "prepare" }, expect.any(String)));
    await vi.waitFor(() => expect(apiMocks.push).toHaveBeenCalledWith("/inventory/created-item"));
  });
  it("retains explicit eBay consent and price bounds", async () => {
    const file = new File(["photo"], "item.jpg", { type: "image/jpeg" });
    reactHarness.states[0] = [{ file, url: "blob:photo" }];
    reactHarness.states[3] = true;
    reactHarness.states[4] = "100";
    reactHarness.states[5] = "200";
    findPrepareButton(NewListingPage())!.props.onClick();
    await vi.waitFor(() => expect(apiMocks.createDraftFromPhotos).toHaveBeenCalledWith("t", [file], { mode: "publish", marketplace: "ebay", consent: true, minPriceCents: 10000, maxPriceCents: 20000 }, expect.any(String)));
  });
  it("does not submit automatic posting with invalid bounds", () => {
    reactHarness.states[0] = [{ file: new File(["photo"], "item.jpg"), url: "blob:photo" }];
    reactHarness.states[3] = true;
    reactHarness.states[4] = "200";
    reactHarness.states[5] = "100";
    findPrepareButton(NewListingPage())!.props.onClick();
    expect(apiMocks.createDraftFromPhotos).not.toHaveBeenCalled();
  });
});
