import "server-only";

// Prisma where-fragment scoping InventoryItem rows to the acting account (the
// shared workspace). Use this in place of `{ sellerId: user.id }` so every
// member of an account sees the same inventory. The creating member is still
// recorded on `sellerId` for attribution.
export function accountScope(account: { id: string }): { accountId: string } {
  return { accountId: account.id };
}

// where-fragment for child rows (drafts, photos, comps, listings) scoped via
// their `inventoryItem` relation.
export function inventoryChildScope(account: { id: string }): {
  inventoryItem: { accountId: string };
} {
  return { inventoryItem: { accountId: account.id } };
}
