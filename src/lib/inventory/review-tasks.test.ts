import { describe, expect, it } from "vitest";

import type {
  Marketplace,
  ReviewTaskStatus,
  ReviewTaskType,
} from "@/generated/prisma/client";

import { createReviewTask, type ReviewTaskPrismaLike } from "./review-tasks";

type FakeTask = {
  id: string;
  userId: string;
  accountId: string;
  type: ReviewTaskType;
  status: ReviewTaskStatus;
  inventoryItemId: string | null;
  marketplace: Marketplace | null;
};

function createFakePrisma(seed: FakeTask[] = []): ReviewTaskPrismaLike & {
  _tasks: FakeTask[];
} {
  const tasks: FakeTask[] = [...seed];
  return {
    _tasks: tasks,
    reviewTask: {
      async findFirst({ where }) {
        const found = tasks.find(
          (t) =>
            t.accountId === where.accountId &&
            t.type === where.type &&
            t.status === where.status &&
            t.inventoryItemId === where.inventoryItemId &&
            t.marketplace === where.marketplace,
        );
        return found ? { id: found.id } : null;
      },
      async create({ data }) {
        const task: FakeTask = {
          id: `task-${tasks.length + 1}`,
          userId: data.userId,
          accountId: data.accountId,
          type: data.type,
          status: "open",
          inventoryItemId: data.inventoryItemId ?? null,
          marketplace: data.marketplace ?? null,
        };
        tasks.push(task);
        return { id: task.id };
      },
    },
  };
}

describe("createReviewTask", () => {
  it("creates a new open task when none exists", async () => {
    const prisma = createFakePrisma();

    const result = await createReviewTask(prisma, {
      userId: "user-1",
      accountId: "account-1",
      type: "confirm_possible_sale",
      inventoryItemId: "item-1",
      marketplace: "grailed",
      title: "t",
      description: "d",
    });

    expect(result.deduped).toBe(false);
    expect(prisma._tasks).toHaveLength(1);
  });

  it("dedupes an existing OPEN task of the same (type, item, marketplace)", async () => {
    const prisma = createFakePrisma();
    const input = {
      userId: "user-1",
      accountId: "account-1",
      type: "manual_delist_required" as const,
      inventoryItemId: "item-1",
      marketplace: "poshmark" as const,
      title: "t",
      description: "d",
    };

    const first = await createReviewTask(prisma, input);
    const second = await createReviewTask(prisma, input);

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    expect(prisma._tasks).toHaveLength(1);
  });

  it("does NOT dedupe across different marketplaces", async () => {
    const prisma = createFakePrisma();
    const base = {
      userId: "user-1",
      accountId: "account-1",
      type: "manual_delist_required" as const,
      inventoryItemId: "item-1",
      title: "t",
      description: "d",
    };

    await createReviewTask(prisma, { ...base, marketplace: "poshmark" });
    const second = await createReviewTask(prisma, { ...base, marketplace: "depop" });

    expect(second.deduped).toBe(false);
    expect(prisma._tasks).toHaveLength(2);
  });

  it("does NOT dedupe a resolved task (only OPEN tasks dedupe)", async () => {
    const prisma = createFakePrisma([
      {
        id: "old",
        userId: "user-1",
        accountId: "account-1",
        type: "confirm_possible_sale",
        status: "resolved",
        inventoryItemId: "item-1",
        marketplace: "grailed",
      },
    ]);

    const result = await createReviewTask(prisma, {
      userId: "user-1",
      accountId: "account-1",
      type: "confirm_possible_sale",
      inventoryItemId: "item-1",
      marketplace: "grailed",
      title: "t",
      description: "d",
    });

    expect(result.deduped).toBe(false);
    expect(prisma._tasks).toHaveLength(2);
  });
});
