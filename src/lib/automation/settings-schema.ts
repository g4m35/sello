import { z } from "zod";

const bounds = {
  minPriceCents: z.number().int().positive(),
  maxPriceCents: z.number().int().positive().max(10_000_000),
};
export const AutomationSettingsInput = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false), expectedRevision: z.string().uuid().nullable() }).strict(),
  z.object({ enabled: z.literal(true), consent: z.literal(true), ...bounds,
    expectedRevision: z.string().uuid().nullable() }).strict(),
]).refine((p) => !p.enabled || p.minPriceCents <= p.maxPriceCents, "Minimum price must not exceed maximum price.");
export const StoredAutomationPolicy = z.object({
  version: z.literal(1), enabled: z.boolean(), revision: z.string().uuid(),
  authorizedBy: z.string(), authorizedAt: z.string().datetime(),
  ...bounds,
}).strict().refine((p) => p.minPriceCents <= p.maxPriceCents);
export const StandingAuthorizationSchema = z.object({ revision: z.string().uuid() }).strict();
export type StandingAuthorization = z.infer<typeof StandingAuthorizationSchema>;
export type AutomationSettings = {
  policy: { enabled: false; revision: null } | {
    enabled: boolean; revision: string; minPriceCents: number; maxPriceCents: number;
  };
  canManage: boolean;
};
