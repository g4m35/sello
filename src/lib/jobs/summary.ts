import type { JobStatus } from "@/generated/prisma/client";

export type JobLogStatusLike = { status: JobStatus };

export type JobSummary = {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
};

const STATUS_KEY: Record<JobStatus, keyof Omit<JobSummary, "total">> = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
};

export function summarizeJobLogs(jobs: JobLogStatusLike[]): JobSummary {
  const summary: JobSummary = {
    total: jobs.length,
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
  };

  for (const job of jobs) {
    summary[STATUS_KEY[job.status]] += 1;
  }

  return summary;
}
