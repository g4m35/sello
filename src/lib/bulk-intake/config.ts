import { AppError } from "@/lib/errors";

export function isBulkIntakeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BULK_INTAKE_ENABLED?.trim().toLowerCase() === "true";
}

export function assertBulkIntakeEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (isBulkIntakeEnabled(env)) return;

  throw new AppError(
    "Bulk intake is temporarily unavailable. Existing batches can still be viewed or canceled.",
    503,
    "BULK_INTAKE_DISABLED",
  );
}
