import { z } from "zod";

// Request schemas, server controls, and the bounded-concurrency helper for bulk
// eBay publishing. There is intentionally NO low product cap: a seller may
// select their whole eligible inventory. The only ceiling is a high, configurable
// transport limit applied server-side, plus internal chunking/concurrency.

type Env = Record<string, string | undefined>;

export function uniqueItemIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

const itemIds = z.array(z.uuid()).min(1).transform(uniqueItemIds);
const marketplace = z.enum(["ebay", "stockx"]).default("ebay");

export const BulkPublishPreflightRequestSchema = z
  .object({
    itemIds,
    marketplace,
    bulkRunId: z.uuid().optional(),
  })
  .strict();

export const BulkPublishExecuteRequestSchema = z
  .object({
    itemIds,
    marketplace,
    bulkRunId: z.uuid().optional(),
    confirmLivePublish: z.literal(true),
  })
  .strict();

export type BulkPublishPreflightRequest = z.infer<typeof BulkPublishPreflightRequestSchema>;
export type BulkPublishExecuteRequest = z.infer<typeof BulkPublishExecuteRequestSchema>;

export type BulkPublishConfig = {
  maxItemsPerRequest: number;
  chunkSize: number;
  concurrency: number;
};

function intEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function loadBulkPublishConfig(env: Env = process.env): BulkPublishConfig {
  return {
    maxItemsPerRequest: intEnv(env.BULK_PUBLISH_MAX_ITEMS, 1000, 1, 1_000_000),
    chunkSize: intEnv(env.BULK_PUBLISH_CHUNK_SIZE, 20, 1, 1000),
    concurrency: intEnv(env.BULK_PUBLISH_CONCURRENCY, 2, 1, 3),
  };
}

// Processes items in sequential chunks; within each chunk at most `concurrency`
// run at once, so global in-flight never exceeds `concurrency`. Results are
// returned in input order regardless of completion order.
export async function processInChunks<T, R>(
  items: T[],
  config: { chunkSize: number; concurrency: number },
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const chunkSize = Math.max(1, config.chunkSize);
  const concurrency = Math.max(1, config.concurrency);

  for (let start = 0; start < items.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, items.length);
    let cursor = start;
    const runner = async (): Promise<void> => {
      for (;;) {
        const i = cursor;
        cursor += 1;
        if (i >= end) return;
        results[i] = await worker(items[i], i);
      }
    };
    const pool = Array.from({ length: Math.min(concurrency, end - start) }, () => runner());
    await Promise.all(pool);
  }
  return results;
}
