import type { User } from "@supabase/supabase-js";

import { AppError } from "@/lib/errors";
import { requireSupabaseUser } from "@/lib/supabase/server";

// Server-only admin gate. There is no admin role system, so admins are an env
// allowlist (ADMIN_USER_IDS and/or ADMIN_EMAILS, comma-separated). Fails closed:
// when neither is configured, nobody is an admin. The full allowlist is never
// sent to the client.

type Env = Record<string, string | undefined>;

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function isAdminUser(
  user: { id?: string | null; email?: string | null },
  env: Env = process.env,
): boolean {
  const ids = parseList(env.ADMIN_USER_IDS);
  const emails = parseList(env.ADMIN_EMAILS);
  if (ids.length === 0 && emails.length === 0) {
    return false;
  }
  const id = (user.id ?? "").toLowerCase();
  const email = (user.email ?? "").toLowerCase();
  return (id.length > 0 && ids.includes(id)) || (email.length > 0 && emails.includes(email));
}

// Resolves the authenticated user and requires admin. Throws 404 (not 403) so the
// admin surface is not revealed to non-admins. Server-side only.
export async function requireAdminUser(request: Request): Promise<User> {
  const user = await requireSupabaseUser(request);
  if (!isAdminUser(user)) {
    throw new AppError("Not found.", 404);
  }
  return user;
}
