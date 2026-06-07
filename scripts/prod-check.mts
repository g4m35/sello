/**
 * Read-only production health check. Mints a temp session via the service role,
 * hits the live read endpoints, asserts they return 200 (not 503 config errors),
 * then deletes the temp user. No inventory/data writes.
 * Run: BASE_URL=https://sello.wtf npx tsx scripts/prod-check.mts
 */
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: fileURLToPath(new URL("../.env.local", import.meta.url)) });

const BASE = process.env.BASE_URL ?? "https://sello.wtf";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(URL_, SR, { auth: { persistSession: false } });
const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

const stamp = String(Date.now());
const email = `prodcheck-${stamp}@example.test`;
const password = `Pw-${stamp}-Aa1!`;
let userId: string | null = null;

async function get(path: string, token: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.text();
  return { status: res.status, body };
}

try {
  console.log(`Prod check against ${BASE}`);
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(created.error?.message);
  userId = created.data.user.id;

  const signIn = await anon.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session) throw new Error(signIn.error?.message);
  const token = signIn.data.session.access_token;

  for (const path of ["/api/listings", "/api/history", "/api/jobs"]) {
    const { status, body } = await get(path, token);
    const ok = status === 200;
    const note = ok ? "" : ` -> ${body.slice(0, 120)}`;
    console.log(`  ${ok ? "PASS" : "FAIL"}  GET ${path} (${status})${note}`);
  }
} catch (e) {
  console.log(`  FATAL ${(e as Error).message}`);
} finally {
  if (userId) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.log("  cleanup: temp user deleted");
  }
}
