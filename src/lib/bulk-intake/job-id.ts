import { createHash } from "node:crypto";

// JobLog.id is a PostgreSQL UUID. UUID v8 reserves its payload for custom
// deterministic schemes; domain separation keeps the two job kinds distinct.
export function bulkJobId(kind: "identify" | "prepare", itemId: string, attempt = 0): string {
  const bytes = createHash("sha256")
    .update(JSON.stringify(["sello.bulk-job.v1", kind, itemId, attempt]))
    .digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
