import { Topbar } from "@/components/app/topbar";
import { PageSkeleton } from "@/components/app/states";

export default function Loading() {
  return (
    <>
      <Topbar crumbs={["Inventory", "Item"]} />
      <PageSkeleton />
    </>
  );
}
