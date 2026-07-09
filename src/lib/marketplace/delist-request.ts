import { z } from "zod";

export const DelistRequestSchema = z
  .object({
    inventoryItemId: z.uuid(),
    marketplace: z.enum(["ebay", "stockx"]),
    confirmLiveDelist: z.literal(true),
  })
  .strict();

export type DelistRequest = z.infer<typeof DelistRequestSchema>;
