import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/marketplace/adapters/etsy/session", () => ({ getEtsyAuthorizedSession: vi.fn() }));
import { executeEtsyWorkerDelist } from "./etsy-delist";
const input = { userId: "user", accountId: "account", inventoryItemId: "item", marketplaceListingId: "listing" };
function fixture(states = ["active", "inactive"]) {
  const row = { id: "listing", externalListingId: "42", status: "LISTED", updatedAt: new Date(0) };
  const db = { marketplaceListing: { findFirst: vi.fn().mockResolvedValue(row), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
  const getListing = vi.fn(); states.forEach(state => getListing.mockResolvedValueOnce({ listing_id: 42, state }));
  const deactivateListing = vi.fn().mockResolvedValue({ listing_id: 42 });
  const session = vi.fn().mockResolvedValue({ shopId: 7, client: { getListing, deactivateListing } });
  return { row, db, getListing, deactivateListing, run: () => executeEtsyWorkerDelist(input, db as never, { session }) };
}
describe("verified Etsy worker removal", () => {
  it("scopes the listing to account and verifies remote deactivation before local success", async () => {
    const f = fixture(); await f.run();
    expect(f.db.marketplaceListing.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "listing", marketplace: "etsy", inventoryItem: { accountId: "account" } }) });
    expect(f.deactivateListing).toHaveBeenCalledWith(7, "42");
    expect(f.getListing).toHaveBeenCalledTimes(2);
    expect(f.db.marketplaceListing.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ updatedAt: new Date(0), status: "LISTED" }), data: expect.objectContaining({ status: "DELISTED" }) });
  });
  it("does not resend deactivation when Etsy already confirms inactive", async () => {
    const f = fixture(["inactive"]); await f.run(); expect(f.deactivateListing).not.toHaveBeenCalled();
  });
  it.each(["sold_out", "unknown", "draft"])("does not remove an unconfirmed active listing: %s", async state => {
    const f = fixture([state]); await expect(f.run()).rejects.toThrow("status needs review"); expect(f.deactivateListing).not.toHaveBeenCalled(); expect(f.db.marketplaceListing.updateMany).not.toHaveBeenCalled();
  });
  it("does not accept a successful HTTP result while listing remains active", async () => {
    const f = fixture(["active", "active"]); await expect(f.run()).rejects.toThrow("not confirmed removal"); expect(f.db.marketplaceListing.updateMany).not.toHaveBeenCalled();
  });
  it("rejects a remote listing identity mismatch before mutation", async () => {
    const f = fixture([]); f.getListing.mockResolvedValue({ listing_id: 99, state: "active" }); await expect(f.run()).rejects.toThrow("different listing"); expect(f.deactivateListing).not.toHaveBeenCalled();
  });
  it("does not overwrite a concurrent sold or listing change", async () => {
    const f = fixture(); f.db.marketplaceListing.updateMany.mockResolvedValue({ count: 0 }); await expect(f.run()).rejects.toThrow("changed during removal");
  });
  it("returns an existing sold state truthfully without contacting Etsy", async () => {
    const f = fixture(); f.row.status = "SOLD";
    await expect(f.run()).resolves.toEqual({ status: "SOLD", changed: false, listingId: "42" });
    expect(f.getListing).not.toHaveBeenCalled(); expect(f.db.marketplaceListing.updateMany).not.toHaveBeenCalled();
  });
  it("does not make provider calls for missing owned listing", async () => {
    const f = fixture(); f.db.marketplaceListing.findFirst.mockResolvedValue(null); await expect(f.run()).rejects.toThrow("could not be found"); expect(f.getListing).not.toHaveBeenCalled();
  });
});
