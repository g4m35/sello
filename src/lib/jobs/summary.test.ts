import { describe, expect, it } from "vitest";

import { summarizeJobLogs } from "./summary";

describe("summarizeJobLogs", () => {
  it("returns all-zero counts for no jobs", () => {
    expect(summarizeJobLogs([])).toEqual({
      total: 0,
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
    });
  });

  it("counts jobs by status without dropping unknowns silently", () => {
    const summary = summarizeJobLogs([
      { status: "QUEUED" },
      { status: "RUNNING" },
      { status: "SUCCEEDED" },
      { status: "FAILED" },
      { status: "FAILED" },
    ]);

    expect(summary).toEqual({
      total: 5,
      queued: 1,
      running: 1,
      succeeded: 1,
      failed: 2,
    });
  });
});
