import { z } from "zod";

export const LifecycleActionSchema = z.enum(["mark_sold", "delist"]);

export type LifecycleAction = z.infer<typeof LifecycleActionSchema>;

export const LifecycleRequestSchema = z
  .object({
    inventoryItemId: z.uuid(),
    action: LifecycleActionSchema,
  })
  .strict();

export type LifecycleRequest = z.infer<typeof LifecycleRequestSchema>;
