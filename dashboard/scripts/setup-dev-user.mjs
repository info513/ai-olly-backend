// ============================================================================
// AI OLLY Dashboard — one-time DEV setup (aiolly-dev only).
// ----------------------------------------------------------------------------
// Creates SYNTHETIC development data so the dashboard has a real account to sign
// in with: a destination, two hotels, one demo staff user (+ profile), and two
// active memberships with DIFFERENT roles (so role-aware navigation is visible
// when switching hotels). Idempotent. Uses the service-role key from ../../.env
// (never committed). No production system is touched.
//
//   node dashboard/scripts/setup-dev-user.mjs
//
// Demo login:  demo@aiolly.dev  /  AiOllyDemo!2026
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../../.env");

function readEnv(key) {
  const line = readFileSync(envPath, "utf8").split("\n").find((l) => l.startsWith(key + "="));
  if (!line) throw new Error(`Missing ${key} in ${envPath}`);
  return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
}

const URL = readEnv("SUPABASE_URL");
const SERVICE_KEY = readEnv("SUPABASE_SERVICE_ROLE_KEY");
const svc = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

const EMAIL = "demo@aiolly.dev";
const PASSWORD = "AiOllyDemo!2026";

async function upsertBySlug(table, slug, row) {
  const found = await svc.from(table).select("id").eq("slug", slug).maybeSingle();
  if (found.data?.id) return found.data.id;
  const ins = await svc.from(table).insert(row).select("id").single();
  if (ins.error) throw new Error(`${table} insert: ${ins.error.message}`);
  return ins.data.id;
}

async function main() {
  console.log("AI OLLY dashboard dev setup →", URL, "\n");

  // 1) destination + two hotels (synthetic dev)
  const destId = await upsertBySlug("destinations", "dash-split", {
    name: "Split (Dev)", slug: "dash-split", timezone: "Europe/Zagreb", default_locale: "en",
  });
  const demoHotel = await upsertBySlug("hotels", "dash-demo-hotel", {
    name: "Demo Hotel", slug: "dash-demo-hotel", destination_id: destId,
    timezone: "Europe/Zagreb", currency: "EUR", country_code: "HR", status: "active",
  });
  const antiqueHotel = await upsertBySlug("hotels", "dash-antique-split", {
    name: "Antique Split", slug: "dash-antique-split", destination_id: destId,
    timezone: "Europe/Zagreb", currency: "EUR", country_code: "HR", status: "active",
  });
  console.log("  ✓ destination + hotels:", { demoHotel, antiqueHotel });

  // 2) demo auth user (idempotent)
  let userId;
  const list = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list.data?.users?.find((u) => u.email === EMAIL);
  if (existing) {
    userId = existing.id;
    console.log("  ✓ auth user exists:", EMAIL);
  } else {
    const created = await svc.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
    if (created.error) throw new Error(`createUser: ${created.error.message}`);
    userId = created.data.user.id;
    console.log("  ✓ auth user created:", EMAIL);
  }

  // 3) profile (not a platform admin, so role-aware nav is demonstrable)
  await svc.from("profiles").upsert(
    { user_id: userId, email: EMAIL, display_name: "Demo Manager", is_platform_admin: false },
    { onConflict: "user_id" }
  );
  console.log("  ✓ profile");

  // 4) two active memberships with DIFFERENT roles
  const memberships = [
    { hotel_id: demoHotel, user_id: userId, role: "hotel_admin", status: "active" },
    { hotel_id: antiqueHotel, user_id: userId, role: "editor", status: "active" },
  ];
  for (const m of memberships) {
    const exists = await svc.from("hotel_memberships").select("id").eq("hotel_id", m.hotel_id).eq("user_id", userId).maybeSingle();
    if (exists.data?.id) {
      await svc.from("hotel_memberships").update({ role: m.role, status: "active" }).eq("id", exists.data.id);
    } else {
      const r = await svc.from("hotel_memberships").insert(m);
      if (r.error) throw new Error(`membership: ${r.error.message}`);
    }
  }
  console.log("  ✓ memberships: hotel_admin@Demo Hotel, editor@Antique Split");

  console.log("\n  Done. Sign in at http://localhost:3100/login");
  console.log(`  →  ${EMAIL}  /  ${PASSWORD}\n`);
}

main().catch((e) => { console.error("  setup error:", e.message); process.exit(1); });
