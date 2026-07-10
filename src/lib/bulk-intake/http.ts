import { NextResponse } from "next/server";

import { AppError, safeClientMessage } from "@/lib/errors";

export function bulkIntakeErrorResponse(error: unknown, label: string) {
  const status = error instanceof AppError ? error.status : 500;
  return NextResponse.json(
    { error: safeClientMessage(error, { label }) },
    { status },
  );
}
