import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AppError, safeClientMessage } from "@/lib/errors";

export function bulkIntakeErrorResponse(error: unknown, label: string) {
  const status = error instanceof AppError ? error.status : error instanceof ZodError ? 400 : 500;
  return NextResponse.json(
    { error: safeClientMessage(error, { label }) },
    { status },
  );
}
