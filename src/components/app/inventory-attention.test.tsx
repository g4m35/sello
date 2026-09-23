import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InventoryAttentionView, reviewAction } from "./inventory-attention";
import type { InventoryReviewTask } from "@/lib/api/client";

const task: InventoryReviewTask = { id: "task", type: "manual_delist_required", status: "open", inventoryItemId: "item", marketplace: "etsy", title: "Remove sold listing from Etsy", description: "This item sold on eBay. Remove its Etsy listing.", createdAt: "2026-09-23T00:00:00Z" };
function render(overrides: Partial<Parameters<typeof InventoryAttentionView>[0]> = {}) {
  return renderToStaticMarkup(<InventoryAttentionView tasks={[task]} notifications={[]} loading={false} errors={[]} busy={false} onRefresh={vi.fn()} onReview={vi.fn()} {...overrides} />);
}
describe("inventory exception visibility", () => {
  it("shows manual work with a listing link and explicit confirmation, never claims automatic removal", () => {
    const html = render();
    expect(html).toContain("Remove sold listing from Etsy");
    expect(html).toContain('href="/inventory/item"');
    expect(html).toContain("Confirm removed");
    expect(reviewAction(task).explanation).toContain("does not remove the external listing");
    expect(html).not.toContain("Not a sale");
  });
  it("makes possible-sale confirmation distinct from dismissal and explains sold/delist effects", () => {
    const possible = { ...task, type: "confirm_possible_sale" };
    expect(render({ tasks: [possible] })).toContain("Not a sale");
    expect(render({ tasks: [possible] })).toContain("Confirm sale");
    expect(reviewAction(possible).explanation).toContain("mark it sold");
  });
  it("keeps stale tasks visible but disables resolution when refreshing fails", () => {
    const html = render({ errors: ["Review tasks could not be refreshed. Try again before resolving a task."] });
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/disabled="">Confirm removed/);
    expect(html).toContain("Remove sold listing from Etsy");
  });
  it("shows dated monitoring failures as history without pretending they establish present health", () => {
    const html = render({ tasks: [], notifications: [{ id: "n", kind: "ebay_order_poll_failed", title: "Sale monitoring stopped", body: "Reconnect eBay.", inventoryItemId: null, createdAt: "2026-09-23T00:00:00Z", readAt: null }] });
    expect(html).toContain("Sale monitoring stopped");
    expect(html).toContain("do not confirm current connection or monitoring health");
    expect(html).toContain('href="/settings/marketplaces"');
  });
  it("does not add an empty dashboard when there is no work or history", () => {
    expect(render({ tasks: [] })).toBe("");
    expect(render({ tasks: [], loading: true })).toContain("Checking for tasks");
  });
});
