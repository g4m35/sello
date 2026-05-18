"use client";

import { useEffect, useState } from "react";

import { getErrorMessage } from "@/lib/errors";
import { readJsonResponse } from "@/lib/http";

type JobRow = {
  id: string;
  queueName: string;
  jobName: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  errorMessage: string | null;
  createdAt: string;
};

type AdapterRow = {
  marketplace: string;
  displayName: string;
  capabilities: { draftPreview: boolean; publish: boolean; inventorySync: boolean };
};

type JobsResponse = {
  jobs: JobRow[];
  summary: {
    total: number;
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
  };
  adapters: AdapterRow[];
  publishingImplemented: boolean;
};

export default function JobsPanel({ accessToken }: { accessToken: string }) {
  const [data, setData] = useState<JobsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadJobs() {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch("/api/jobs", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const payload = await readJsonResponse<JobsResponse>(response);

        if (!cancelled) {
          setData(payload);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(getErrorMessage(loadError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadJobs();

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  if (isLoading) {
    return <p className="mt-5 text-sm text-neutral-500">Loading job activity…</p>;
  }

  if (error) {
    return (
      <p className="mt-5 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
        {error}
      </p>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="mt-5 flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Total", data.summary.total],
          ["Queued", data.summary.queued],
          ["Running", data.summary.running],
          ["Succeeded", data.summary.succeeded],
          ["Failed", data.summary.failed],
        ].map(([label, value]) => (
          <div key={label as string} className="border border-neutral-200 p-3">
            <p className="text-xs uppercase tracking-[0.12em] text-neutral-500">{label}</p>
            <p className="mt-1 text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <div className="border border-neutral-300">
        <div className="border-b border-neutral-200 p-4">
          <p className="text-sm font-semibold">Recent jobs ({data.jobs.length})</p>
        </div>
        {data.jobs.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">
            No background jobs have run. Workers are not implemented; publishing
            stays draft-only. This list is real, not simulated.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-[0.12em] text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Queue</th>
                  <th className="px-4 py-3 font-medium">Job</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((job) => (
                  <tr key={job.id} className="border-b border-neutral-100 align-top">
                    <td className="px-4 py-3 font-mono text-xs">{job.queueName}</td>
                    <td className="px-4 py-3">
                      {job.jobName}
                      {job.errorMessage ? (
                        <span className="mt-1 block text-xs text-red-700">
                          {job.errorMessage}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{job.status}</td>
                    <td className="px-4 py-3 text-neutral-500">
                      {new Date(job.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="border border-neutral-300">
        <div className="border-b border-neutral-200 p-4">
          <p className="text-sm font-semibold">Marketplace adapters</p>
        </div>
        <div className="grid gap-px bg-neutral-200 sm:grid-cols-2">
          {data.adapters.map((adapter) => (
            <div key={adapter.marketplace} className="bg-white p-4 text-sm">
              <p className="font-medium">{adapter.displayName}</p>
              <p className="mt-1 text-xs text-neutral-600">
                Draft preview: yes · Publish:{" "}
                {adapter.capabilities.publish ? "yes" : "not implemented"} ·
                Inventory sync:{" "}
                {adapter.capabilities.inventorySync ? "yes" : "not implemented"}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
