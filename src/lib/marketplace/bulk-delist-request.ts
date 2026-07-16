import { z } from "zod";

import { uniqueItemIds } from "./bulk-publish-request";

// Request schemas for bulk eBay end/delist. Mirrors the bulk-publish schemas:
// no low product cap, just the shared transport/concurrency ceiling. The
// execute schema requires an explicit live confirmation, exactly like a single
// delist.

const itemIds = z.array(z.uuid()).min(1).transform(uniqueItemIds);
const marketplace = z.enum(["ebay", "stockx"]).default("ebay");

export const BulkDelistPreflightRequestSchema = z
  .object({ itemIds, marketplace })
  .strict();

export const BulkDelistExecuteRequestSchema = z
  .object({
    itemIds,
    marketplace,
    bulkRunId: z.uuid().optional(),
    confirmLiveDelist: z.literal(true),
  })
  .strict();

export type BulkDelistPreflightRequest = z.infer<typeof BulkDelistPreflightRequestSchema>;
export type BulkDelistExecuteRequest = z.infer<typeof BulkDelistExecuteRequestSchema>;
