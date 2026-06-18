import { z } from "zod";

// Validated at the API boundary. Strict objects so client-supplied fields like
// userId/status can never be trusted from the request body.

export const FEEDBACK_TYPES = [
  "bug",
  "feature_request",
  "confusion",
  "pricing_issue",
  "marketplace_issue",
  "other",
] as const;

export const FEEDBACK_SEVERITIES = ["low", "medium", "high"] as const;

export const FEEDBACK_MARKETPLACES = [
  "ebay",
  "grailed",
  "poshmark",
  "depop",
  "mercari",
  "other",
] as const;

export const FEEDBACK_STATUSES = ["open", "reviewing", "resolved", "dismissed"] as const;

export const CreateFeedbackSchema = z
  .object({
    type: z.enum(FEEDBACK_TYPES),
    severity: z.enum(FEEDBACK_SEVERITIES).default("medium"),
    marketplace: z.enum(FEEDBACK_MARKETPLACES).nullish(),
    subject: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(5000),
    pageUrl: z.string().trim().max(500).nullish(),
    listingId: z.uuid().nullish(),
    draftId: z.uuid().nullish(),
  })
  .strict();

export type CreateFeedbackInput = z.infer<typeof CreateFeedbackSchema>;

export const FeedbackIdSchema = z.uuid();

export const UpdateFeedbackSchema = z
  .object({
    status: z.enum(FEEDBACK_STATUSES).optional(),
    adminNotes: z.string().trim().max(5000).nullish(),
  })
  .strict()
  .refine((data) => data.status !== undefined || data.adminNotes !== undefined, {
    message: "Provide a status or admin note to update.",
  });

export type UpdateFeedbackInput = z.infer<typeof UpdateFeedbackSchema>;
