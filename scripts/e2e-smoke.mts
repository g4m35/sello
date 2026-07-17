/**
 * Authenticated end-to-end smoke test against the running dev server + live
 * Supabase/Postgres. Mints a real session via the service role, exercises the
 * new read/import/publish endpoints, then deletes everything it created.
 *
 * Prints only statuses, counts, and ids. Never prints tokens or secrets.
 * Run: BASE_URL=http://localhost:3940 npx tsx scripts/e2e-smoke.mts
 */
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

loadEnv({ path: fileURLToPath(new URL("../.env.local", import.meta.url)) });

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3940";
const SUPABASE_URL = req("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = req("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_ROLE = req("SUPABASE_SERVICE_ROLE_KEY");
const DATABASE_URL = req("DATABASE_URL");

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}${detail ? ` (${detail})` : ""}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` (${detail})` : ""}`);
  }
}

async function callApi(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const prisma = new PrismaClient({ adapter: new PrismaPg(DATABASE_URL) });

const stamp = process.env.STAMP ?? String(Date.now());
const email = `e2e-smoke-${stamp}@example.test`;
const password = `Pw-${stamp}-Aa1!`;
let userId: string | null = null;

async function main() {
  console.log(`E2E against ${BASE_URL}`);

  // 1. Unauthenticated request is rejected.
  const noAuth = await fetch(`${BASE_URL}/api/listings`);
  check("GET /api/listings without auth -> 401", noAuth.status === 401, `status ${noAuth.status}`);

  // 2. Create a temp confirmed user via the service role.
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`createUser failed: ${created.error?.message}`);
  }
  userId = created.data.user.id;
  check("admin.createUser", true, `user ${userId.slice(0, 8)}…`);

  // 3. Sign in to obtain a real access token.
  const signIn = await anon.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session) {
    throw new Error(`signIn failed: ${signIn.error?.message}`);
  }
  const token = signIn.data.session.access_token;
  check("signInWithPassword -> access token", token.length > 20);

  // 4. Authenticated reads on an empty account.
  const list0 = await callApi("/api/listings", token);
  const list0Items = (list0.json as { items?: unknown[] })?.items ?? [];
  check("GET /api/listings (empty) -> 200 + items[]", list0.status === 200 && Array.isArray(list0Items), `status ${list0.status}, ${list0Items.length} items`);

  const history0 = await callApi("/api/history", token);
  const history0Items = (history0.json as { attempts?: unknown[] })?.attempts ?? [];
  check("GET /api/history (empty) -> 200 + attempts[]", history0.status === 200 && Array.isArray(history0Items), `status ${history0.status}`);

  const jobs = await callApi("/api/jobs", token);
  const adapters = (jobs.json as { adapters?: Array<Record<string, unknown>> })?.adapters ?? [];
  check("GET /api/jobs -> 9 adapters", jobs.status === 200 && adapters.length === 9, `${adapters.length} adapters`);
  check(
    "  mercari adapter registered",
    adapters.some((a) => JSON.stringify(a).includes("mercari")),
  );

  // 5. Real CSV import: creates a draft item.
  const imp = await callApi("/api/listings/import", token, {
    method: "POST",
    body: JSON.stringify({
      rows: [
        {
          title: `E2E Smoke Item ${stamp}`,
          brand: "TestBrand",
          size: "10",
          condition: "Like New",
          color: "Black",
          priceCents: 12300,
          sku: `E2E-${stamp}`,
        },
      ],
    }),
  });
  const createdCount = (imp.json as { created?: number })?.created ?? 0;
  check("POST /api/listings/import -> created 1", imp.status === 200 && createdCount === 1, `status ${imp.status}, created ${createdCount}`);

  // 6. The imported item appears in the list, mapped correctly.
  const list1 = await callApi("/api/listings", token);
  const items1 = (list1.json as { items?: Array<Record<string, unknown>> })?.items ?? [];
  const item = items1[0];
  check("GET /api/listings shows imported item", items1.length === 1 && !!item, `${items1.length} items`);
  if (item) {
    check("  item.priceCents mapped from CSV", item.priceCents === 12300, `${item.priceCents}`);
    check("  item.status === draft", item.status === "draft", `${item.status}`);
    check("  item.channels has 9 real marketplaces", Array.isArray(item.channels) && (item.channels as unknown[]).length === 9, `${(item.channels as unknown[])?.length}`);
  }

  const itemId = item?.id as string | undefined;
  if (itemId) {
    // 7. Detail endpoint with readiness + condition mapping.
    const detail = await callApi(`/api/listings/${itemId}`, token);
    const d = (detail.json as { item?: Record<string, unknown> })?.item;
    check("GET /api/listings/[id] -> 200", detail.status === 200 && !!d, `status ${detail.status}`);
    if (d) {
      check("  condition normalized to used_excellent", d.condition === "used_excellent", `${d.condition}`);
      const readiness = d.readiness as { ready?: boolean; checks?: unknown[] } | undefined;
      check("  readiness present with checks", !!readiness && Array.isArray(readiness.checks), `${readiness?.checks?.length} checks`);
    }

    // 8a. eBay publish is fail-closed locally: sandbox gate returns a typed
    // 200 EBAY_PUBLISH_NOT_ENABLED outcome and publishes nothing. (Readiness
    // is evaluated per adapter; only terminal items are refused outright.)
    const pubDraft = await callApi("/api/listings/publish", token, {
      method: "POST",
      body: JSON.stringify({ inventoryItemId: itemId, marketplace: "ebay" }),
    });
    const pdj = pubDraft.json as { code?: string };
    check(
      "publish ebay locally -> 200 EBAY_PUBLISH_NOT_ENABLED (fail-closed)",
      pubDraft.status === 200 && pdj.code === "EBAY_PUBLISH_NOT_ENABLED",
      `status ${pubDraft.status}, code ${pdj.code}`,
    );

    // 8b. Approval is readiness-gated. First prove the gate blocks an item
    // with no photos, then satisfy readiness and approve for real.
    const draftId = item?.draftId as string | undefined;
    check("imported item has a draftId", !!draftId);
    if (draftId) {
      const readyPatchBody = {
        title: `E2E Smoke Item ${stamp} ready`,
        description: "Authenticated end-to-end smoke item with a sufficiently long description.",
        bulletPoints: ["Condition like new", "Ships in 1 business day", "Cleanup covered by this script"],
        recommendedPriceCents: 12300,
        selectedMarketplaces: ["grailed"],
        approve: true,
      };

      const blocked = await callApi(`/api/listings/draft/${draftId}`, token, {
        method: "PATCH",
        body: JSON.stringify(readyPatchBody),
      });
      check("approve without photos -> 400 (readiness gate)", blocked.status === 400, `status ${blocked.status}`);

      // DB-level photo fixture: satisfies the photo-count readiness check
      // without a storage object. Cascades away with the inventory item.
      await prisma.itemPhoto.create({
        data: {
          inventoryItemId: itemId,
          storageBucket: "e2e-smoke",
          storagePath: `e2e/${stamp}.jpg`,
          mimeType: "image/jpeg",
          originalName: "e2e.jpg",
          position: 0,
        },
      });

      const patch = await callApi(`/api/listings/draft/${draftId}`, token, {
        method: "PATCH",
        body: JSON.stringify(readyPatchBody),
      });
      check("PATCH draft approve -> 200", patch.status === 200, `status ${patch.status}`);

      const detailReady = await callApi(`/api/listings/${itemId}`, token);
      const dr = (detailReady.json as { item?: Record<string, unknown> })?.item;
      check("item is ready after approval", dr?.lifecycleState === "ready", `${dr?.lifecycleState}`);

      // 8c. Honest publish on a stub channel: real NOT_IMPLEMENTED outcome (HTTP 501).
      const pub = await callApi("/api/listings/publish", token, {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: itemId, marketplace: "grailed" }),
      });
      const pj = pub.json as { code?: string; status?: string };
      check("POST /api/listings/publish grailed -> 501 NOT_IMPLEMENTED", pub.status === 501 && pj.code === "NOT_IMPLEMENTED", `status ${pub.status}, code ${pj.code}`);
    }

    // 9. Both attempts are in history with honest raw statuses.
    const history1 = await callApi("/api/history", token);
    const attempts = (history1.json as { attempts?: Array<Record<string, unknown>> })?.attempts ?? [];
    const attempt = attempts[0];
    check("GET /api/history shows the attempts", attempts.length >= 2, `${attempts.length} attempts`);
    if (attempt) {
      check("  latest attempt.rawStatus === NOT_IMPLEMENTED", attempt.rawStatus === "NOT_IMPLEMENTED", `${attempt.rawStatus}`);
      check("  latest attempt.marketplaceName === Grailed", attempt.marketplaceName === "Grailed", `${attempt.marketplaceName}`);
    }

    // 10. Guided publish: structured export payload for the new channels.
    const mercariExport = await callApi(
      `/api/listings/${itemId}/export?marketplace=mercari`,
      token,
    );
    const me = mercariExport.json as {
      title?: string;
      body?: string;
      fields?: Array<{ key: string; label: string; value: string }>;
    };
    check(
      "GET export?marketplace=mercari -> 200 + fields[]",
      mercariExport.status === 200 && Array.isArray(me.fields) && me.fields.length > 0,
      `status ${mercariExport.status}, ${me.fields?.length ?? 0} fields`,
    );
    check("  mercari title within 80 chars", (me.title ?? "").length > 0 && (me.title ?? "").length <= 80, `${me.title?.length} chars`);
    check(
      "  fields carry stable title/description keys",
      ["title", "description"].every((k) => !!me.fields?.some((f) => f.key === k)),
    );

    const vintedExport = await callApi(
      `/api/listings/${itemId}/export?marketplace=vinted`,
      token,
    );
    const ve = vintedExport.json as { body?: string };
    check(
      "GET export?marketplace=vinted -> 200, no hashtags",
      vintedExport.status === 200 && !!ve.body && !ve.body.includes("#"),
      `status ${vintedExport.status}`,
    );

    const badExport = await callApi(`/api/listings/${itemId}/export?marketplace=stockx`, token);
    check("GET export?marketplace=stockx -> 400", badExport.status === 400, `status ${badExport.status}`);

    // 11. Mark as listed: a seller-pasted mercari URL is recorded for the
    // double-sell safety engine (cleanup cascades with the inventory item).
    const externalUrl = `https://www.mercari.com/us/item/e2e${stamp}/`;
    const marked = await callApi("/api/inventory/listings", token, {
      method: "POST",
      body: JSON.stringify({
        inventoryItemId: itemId,
        marketplace: "mercari",
        externalUrl,
        status: "LISTED",
      }),
    });
    const mj = marked.json as {
      ok?: boolean;
      listing?: { id?: string; status?: string; externalUrl?: string | null };
    };
    check(
      "POST /api/inventory/listings (mercari) -> ok + listing",
      marked.status === 200 && mj.ok === true && !!mj.listing?.id,
      `status ${marked.status}`,
    );
    check("  listing echoes the pasted URL", mj.listing?.externalUrl === externalUrl);
    check("  listing recorded as LISTED", mj.listing?.status === "LISTED", `${mj.listing?.status}`);
  }
}

async function cleanup() {
  try {
    if (userId) {
      const del = await prisma.inventoryItem.deleteMany({ where: { sellerId: userId } });
      console.log(`  cleanup: deleted ${del.count} inventory rows`);
      await admin.auth.admin.deleteUser(userId);
      console.log(`  cleanup: deleted test user`);
    }
  } catch (e) {
    console.log(`  cleanup error: ${(e as Error).message}`);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((e) => {
    failed++;
    console.log(`  FATAL ${(e as Error).message}`);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\nResult: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  });
