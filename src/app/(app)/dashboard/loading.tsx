import { PageSkeleton } from "@/components/app/states";

// Centered brand loader only — no topbar crumbs or skeleton rows.
export default function Loading() {
  return <PageSkeleton />;
}
