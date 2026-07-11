import type {
  Marketplace,
  Prisma,
  ReviewTaskStatus,
  ReviewTaskType,
} from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";

// System-generated tasks requiring seller action (confirm a possible sale,
// manually delist a channel with no adapter, an unmatched marketplace email, or
// a sync conflict). Tasks are never auto-resolved. Creation dedupes an already
// OPEN task of the same (type, inventoryItemId, marketplace) so a repeated
// signal (e.g. re-delivered email, re-run mark-sold) can't pile up duplicates.

export type ReviewTaskPrismaLike = {
  reviewTask: {
    findFirst(args: {
      where: {
        userId?: string;
        accountId?: string;
        type: ReviewTaskType;
        status: ReviewTaskStatus;
        inventoryItemId: string | null;
        marketplace: Marketplace | null;
        dedupeKey?: string;
      };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    create(args: {
      data: {
        userId: string;
        accountId: string;
        inventoryItemId?: string | null;
        marketplace?: Marketplace | null;
        type: ReviewTaskType;
        title: string;
        description: string;
        payload: Prisma.InputJsonValue;
        dedupeKey?: string | null;
      };
    }): Promise<{ id: string }>;
  };
};

export type CreateReviewTaskInput = {
  userId: string;
  accountId: string;
  type: ReviewTaskType;
  inventoryItemId?: string | null;
  marketplace?: Marketplace | null;
  title: string;
  description: string;
  payload?: Prisma.InputJsonValue;
  dedupeKey?: string | null;
};

export type CreateReviewTaskResult = {
  id: string;
  // True when an existing OPEN task matched and no new row was created.
  deduped: boolean;
};

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002",
  );
}

export async function createReviewTask(
  db: ReviewTaskPrismaLike = getPrisma(),
  input: CreateReviewTaskInput,
): Promise<CreateReviewTaskResult> {
  const inventoryItemId = input.inventoryItemId ?? null;
  const marketplace = input.marketplace ?? null;

  const existing = await db.reviewTask.findFirst({
    where: {
      accountId: input.accountId,
      type: input.type,
      status: "open",
      inventoryItemId,
      marketplace,
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
    },
    select: { id: true },
  });
  if (existing) {
    return { id: existing.id, deduped: true };
  }

  try {
    const created = await db.reviewTask.create({
      data: {
        userId: input.userId,
        accountId: input.accountId,
        inventoryItemId,
        marketplace,
        type: input.type,
        title: input.title,
        description: input.description,
        payload: input.payload ?? {},
        dedupeKey: input.dedupeKey ?? null,
      },
    });
    return { id: created.id, deduped: false };
  } catch (error) {
    if (!input.dedupeKey || !isUniqueViolation(error)) throw error;
    const raced = await db.reviewTask.findFirst({
      where: {
        accountId: input.accountId,
        type: input.type,
        status: "open",
        inventoryItemId,
        marketplace,
        dedupeKey: input.dedupeKey,
      },
      select: { id: true },
    });
    if (!raced) throw error;
    return { id: raced.id, deduped: true };
  }
}
