import { notFound } from "next/navigation";

import { isAdminUser } from "@/lib/auth/admin";
import { getSupabaseUserFromCookies } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSupabaseUserFromCookies();
  if (!user || !isAdminUser(user)) {
    notFound();
  }

  return children;
}
