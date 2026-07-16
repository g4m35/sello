import { describe, expect, it } from "vitest";

import { recordInventoryEvent, type InventoryEventPrismaLike } from "./events";

function createFakePrisma(): InventoryEventPrismaLike & {
  _events: Array<Record<string, unknown>>;
} {
  const events: Array<Record<string, unknown>> = [];
  return {
    _events: events,
    inventoryEvent: {
      async create({ data }) {
        events.push(data as Record<string, unknown>);
        return { id: `event-${events.length}` };
      },
    },
  };
}

describe("recordInventoryEvent", () => {
  it("records an event with the given fields", async () => {
    const prisma = createFakePrisma();

    await recordInventoryEvent(prisma, {
      inventoryItemId: "item-1",
      userId: "user-1",
      accountId: "account-1",
      type: "sale_detected",
      source: "api",
      marketplace: "grailed",
      confidence: 0.9,
      payload: { foo: "bar" },
    });

    expect(prisma._events[0]).toMatchObject({
      inventoryItemId: "item-1",
      userId: "user-1",
      accountId: "account-1",
      type: "sale_detected",
      source: "api",
      marketplace: "grailed",
      confidence: 0.9,
      payload: { foo: "bar" },
    });
  });

  it("defaults marketplace/confidence to null and payload to an empty object", async () => {
    const prisma = createFakePrisma();

    await recordInventoryEvent(prisma, {
      inventoryItemId: "item-1",
      userId: "user-1",
      accountId: "account-1",
      type: "notification_sent",
      source: "system",
    });

    expect(prisma._events[0]).toMatchObject({
      marketplace: null,
      confidence: null,
      payload: {},
    });
  });
});
