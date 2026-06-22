import { Topbar } from "@/components/app/topbar";
import { PageSkeleton } from "@/components/app/states";

// Instant skeleton during route navigation, so moving between screens never
// shows a blank frame before the page's own data loads.
export default function Loading() {
  return (
    <>
      <Topbar crumbs={["Dashboard"]} />
      <PageSkeleton />
    </>
  );
}
