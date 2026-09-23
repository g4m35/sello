import { AppError } from "@/lib/errors";

export class BulkStepTimeout extends AppError {
  constructor() { super("Preparation exceeded its time limit. Review this item before retrying.", 504, "BULK_GENERATION_TIMEOUT"); }
}

// Only race read-only download/generation promises. Never race the service or
// database writes: a late provider result must not resume persistence.
export async function withinBulkDeadline<T>(work: (signal: AbortSignal, timeoutMs: number) => Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new BulkStepTimeout();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new BulkStepTimeout());
          controller.abort();
        }, remaining);
      }),
      work(controller.signal, remaining),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
