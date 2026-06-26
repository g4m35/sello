import type {
  InventoryEventType,
  Marketplace,
  Prisma,
  SignalSource,
} from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";

// Append-only audit trail for the double-sell-prevention engine. Every safety
// action/signal (sale detected/confirmed, delist requested, conflict, etc.) is
// recorded item-scoped + user-scoped so the timeline is reconstructable. This is
// the lowest layer: mark-sold, delist, and sale-signal all call through here.

// The narrow surface every inventory module depends on. Accepting a structural
// type (not the full PrismaClient) keeps the functions trivially unit-testable
// with an in-memory fake, matching the publish/delist handler pattern.
export type InventoryEventPrismaLike = {
  inventoryEvent: {
    create(args: {
      data: {
        inventoryItemId: string;
        userId: string;
        type: InventoryEventType;
        source: SignalSource;
        marketplace?: Marketplace | null;
        confidence?: number | null;
        payload: Prisma.InputJsonValue;
      };
    }): Promise<{ id: string }>;
  };
};

export type RecordInventoryEventInput = {
  inventoryItemId: string;
  userId: string;
  type: InventoryEventType;
  source: SignalSource;
  marketplace?: Marketplace | null;
  confidence?: number | null;
  payload?: Prisma.InputJsonValue;
};

export async function recordInventoryEvent(
  db: InventoryEventPrismaLike = getPrisma(),
  input: RecordInventoryEventInput,
): Promise<{ id: string }> {
  return db.inventoryEvent.create({
    data: {
      inventoryItemId: input.inventoryItemId,
      userId: input.userId,
      type: input.type,
      source: input.source,
      marketplace: input.marketplace ?? null,
      confidence: input.confidence ?? null,
      payload: input.payload ?? {},
    },
  });
}
