/** Deletes any leftover e2e-smoke test users via the service role (no DB). */
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: fileURLToPath(new URL("../.env.local", import.meta.url)) });

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
if (error) {
  console.log(`listUsers error: ${error.message}`);
  process.exit(1);
}
const targets = data.users.filter((u) => (u.email ?? "").startsWith("e2e-smoke-"));
for (const u of targets) {
  await admin.auth.admin.deleteUser(u.id);
  console.log(`deleted ${u.email}`);
}
console.log(`cleanup done: removed ${targets.length} test user(s)`);
