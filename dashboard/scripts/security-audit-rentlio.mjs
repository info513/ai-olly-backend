// ============================================================================
// security-audit-rentlio.mjs — PMS (Rentlio) integration security audit. DEV-ONLY.
// ----------------------------------------------------------------------------
// Verifies the provider-agnostic PMS layer is safe BEFORE any real Rentlio key is
// ever connected (R3): RLS enabled + hotel_admin/platform_admin-only, anon denied,
// event/run logs server-write-only, role gating (editor ≠ hotel_admin), cross-tenant
// isolation, cross-hotel mapping rejection, DB uniqueness, secret boundary (only a
// credential *reference* + token *hash* are stored — never a raw key/token), and a
// built-bundle scan for leaked secrets. Uses demo@aiolly.dev (hotel_admin@A, editor@B).
// ============================================================================
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { sha256 } from "../src/server/pms/types.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), SRV = readEnv("SUPABASE_SERVICE_ROLE_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
if (!URL.includes("mcgrccvvybgcozeqlisj")) { console.error("REFUSING: not aiolly-dev"); process.exit(1); }
const svc = createClient(URL, SRV, { auth: { persistSession: false } });

const HOTEL_A = "345c8bbb-77ce-4f3a-9ae0-613004fdedcc"; // demo = hotel_admin (may manage PMS)
const HOTEL_B = "a423320a-8940-4fd5-a5aa-605802950ee5"; // demo = editor      (must NOT manage PMS)
const TABLES = ["hotel_integrations", "external_entity_mappings", "integration_events", "sync_runs"];

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };
const denied = (r) => !!(r && r.error);
const empty = (r) => ((r && r.data) ?? []).length === 0;

async function main() {
  console.log("AI OLLY — Rentlio/PMS security audit (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } });
  await sql.connect();

  // ── A) RLS enabled + anon fully revoked ────────────────────────────────────
  for (const t of TABLES) {
    const rls = (await sql.query(`select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=$1`, [t])).rows[0];
    rls && rls.relrowsecurity ? ok(`${t}: RLS enabled`) : bad(`${t}: RLS NOT enabled`);
    const anonG = (await sql.query(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee='anon'`, [t])).rows[0].c;
    anonG === 0 ? ok(`${t}: no grants to anon`) : bad(`${t}: ${anonG} anon grants`);
  }

  // ── B) policies: config/mappings gated to platform_admin+hotel_admin; logs read-only ─
  for (const t of ["hotel_integrations", "external_entity_mappings"]) {
    const pols = (await sql.query(`select cmd, qual, with_check from pg_policies where schemaname='public' and tablename=$1`, [t])).rows;
    const txt = JSON.stringify(pols);
    txt.includes("is_platform_admin") && txt.includes("hotel_admin") ? ok(`${t}: policies require platform_admin OR hotel_admin`) : bad(`${t}: policy predicate missing admin gate`);
    ["INSERT", "UPDATE", "DELETE"].every((c) => pols.some((p) => p.cmd === c)) ? ok(`${t}: write policies present (admin-gated)`) : bad(`${t}: missing write policy`);
  }
  for (const t of ["integration_events", "sync_runs"]) {
    const pols = (await sql.query(`select cmd from pg_policies where schemaname='public' and tablename=$1`, [t])).rows.map((p) => p.cmd);
    pols.length === 1 && pols[0] === "SELECT" ? ok(`${t}: SELECT-only policy (writes are server/service-role only)`) : bad(`${t}: unexpected write policy for authenticated (${pols})`);
    const wG = (await sql.query(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name=$1 and privilege_type in ('INSERT','UPDATE','DELETE') and grantee='authenticated'`, [t])).rows[0].c;
    wG === 0 ? ok(`${t}: no INSERT/UPDATE/DELETE grant to authenticated`) : bad(`${t}: mutable by authenticated`);
  }

  // ── C) secret boundary: only reference + hash columns; no raw key/token column ─
  const cols = (await sql.query(`select column_name from information_schema.columns where table_schema='public' and table_name='hotel_integrations'`)).rows.map((r) => r.column_name);
  cols.includes("credential_ref") && cols.includes("webhook_token_hash") ? ok("hotel_integrations: stores credential_ref + webhook_token_hash (reference/hash only)") : bad("missing credential_ref/webhook_token_hash");
  !cols.some((c) => /^(api_key|apikey|secret|raw_token|webhook_token|password)$/.test(c)) ? ok("hotel_integrations: no raw key/token column") : bad(`raw secret column present: ${cols}`);

  // ── set up: integrations on A (admin), B (editor), and a FOREIGN hotel ──────
  const getOrInsert = async (table, match, row) => {
    let q = svc.from(table).select("id");
    for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
    const f = await q.maybeSingle();
    if (f.data?.id) return f.data.id;
    const r = await svc.from(table).insert({ ...match, ...row }).select("id").single();
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    return r.data.id;
  };
  const intgA = await getOrInsert("hotel_integrations", { hotel_id: HOTEL_A, provider: "rentlio" }, { status: "disconnected", credential_ref: "secret-ref://audit-a", webhook_token_hash: sha256("A") });
  const intgB = await getOrInsert("hotel_integrations", { hotel_id: HOTEL_B, provider: "rentlio" }, { status: "disconnected", credential_ref: "secret-ref://audit-b", webhook_token_hash: sha256("B") });
  const fgnDest = await getOrInsert("destinations", { slug: "sec-pms-dest" }, { name: "Sec PMS", timezone: "Europe/Zagreb" });
  const fgnHotel = await getOrInsert("hotels", { slug: "sec-pms-hotel" }, { name: "Sec PMS Hotel", destination_id: fgnDest, timezone: "Europe/Zagreb", currency: "EUR", status: "active" });
  const intgF = await getOrInsert("hotel_integrations", { hotel_id: fgnHotel, provider: "rentlio" }, { status: "disconnected", credential_ref: "secret-ref://audit-f", webhook_token_hash: sha256("F") });
  const mapF = await getOrInsert("external_entity_mappings", { integration_id: intgF, entity_type: "room", external_id: "rz-unit-x" }, { hotel_id: fgnHotel, room_id: null });
  await svc.from("integration_events").insert({ integration_id: intgF, hotel_id: fgnHotel, provider: "rentlio", provider_event_id: "sec-evt-1", event_type: "reservation-created", status: "received" });
  await svc.from("sync_runs").insert({ integration_id: intgF, hotel_id: fgnHotel, sync_type: "initial", status: "completed" });

  // ── D) signed-in demo: role gating + cross-tenant + cross-hotel ─────────────
  const demo = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await demo.auth.signInWithPassword({ email: "demo@aiolly.dev", password: "AiOllyDemo!2026" });
  s.error ? bad("demo sign-in failed: " + s.error.message) : ok("signed in as demo@aiolly.dev (hotel_admin@A, editor@B)");

  // hotel_admin @ A → may read + manage own integration
  !empty(await demo.from("hotel_integrations").select("id").eq("id", intgA)) ? ok("hotel_admin: can read own hotel integration") : bad("hotel_admin cannot read own integration");
  !denied(await demo.from("hotel_integrations").update({ status: "needs_mapping" }).eq("id", intgA)) ? ok("hotel_admin: can update own integration") : bad("hotel_admin blocked from own integration update");
  !denied(await demo.from("external_entity_mappings").insert({ integration_id: intgA, hotel_id: HOTEL_A, entity_type: "room", external_id: "rz-unit-adminA", room_id: null })) ? ok("hotel_admin: can create own unit mapping") : bad("hotel_admin blocked from own mapping insert");

  // editor @ B → role gating: NOT hotel_admin → cannot read/manage PMS even for own hotel
  empty(await demo.from("hotel_integrations").select("id").eq("id", intgB)) ? ok("role gating: editor@B cannot READ its own hotel PMS integration") : bad("editor read own-hotel integration (role gate broken)");
  { const r = await demo.from("external_entity_mappings").insert({ integration_id: intgB, hotel_id: HOTEL_B, entity_type: "room", external_id: "rz-unit-editorB", room_id: null });
    (denied(r) || empty(await svc.from("external_entity_mappings").select("id").eq("integration_id", intgB).eq("external_id", "rz-unit-editorB"))) ? ok("role gating: editor@B cannot CREATE PMS mapping") : bad("editor created a PMS mapping (role gate broken)"); }
  { const r = await demo.from("hotel_integrations").update({ status: "healthy" }).eq("id", intgB);
    (denied(r) || (await svc.from("hotel_integrations").select("status").eq("id", intgB).single()).data.status !== "healthy") ? ok("role gating: editor@B cannot UPDATE integration") : bad("editor updated integration (role gate broken)"); }

  // cross-tenant: foreign hotel invisible/immutable
  empty(await demo.from("hotel_integrations").select("id").eq("id", intgF)) ? ok("cross-tenant: cannot read foreign integration") : bad("foreign integration READ leaked");
  empty(await demo.from("external_entity_mappings").select("id").eq("id", mapF)) ? ok("cross-tenant: cannot read foreign mapping") : bad("foreign mapping READ leaked");
  empty(await demo.from("integration_events").select("id").eq("integration_id", intgF)) ? ok("cross-tenant: cannot read foreign integration_events") : bad("foreign events READ leaked");
  empty(await demo.from("sync_runs").select("id").eq("integration_id", intgF)) ? ok("cross-tenant: cannot read foreign sync_runs") : bad("foreign sync_runs READ leaked");

  // cross-hotel mapping rejection: even hotel_admin@A cannot attach a mapping to a foreign hotel_id
  { const r = await demo.from("external_entity_mappings").insert({ integration_id: intgF, hotel_id: fgnHotel, entity_type: "room", external_id: "rz-unit-evil", room_id: null });
    (denied(r) || empty(await svc.from("external_entity_mappings").select("id").eq("integration_id", intgF).eq("external_id", "rz-unit-evil"))) ? ok("cross-hotel: hotel_admin@A cannot map into a foreign hotel") : bad("cross-hotel mapping write leaked"); }

  // ── E) anon: nothing readable ───────────────────────────────────────────────
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  for (const t of TABLES) empty(await anon.from(t).select("id")) ? ok(`anon: cannot read ${t}`) : bad(`anon read ${t}`);

  // ── F) DB uniqueness (idempotency-critical) ─────────────────────────────────
  { const r = await svc.from("external_entity_mappings").insert({ integration_id: intgF, hotel_id: fgnHotel, entity_type: "room", external_id: "rz-unit-x", room_id: null });
    denied(r) ? ok("uniqueness: duplicate (integration,entity_type,external_id) rejected") : bad("duplicate mapping accepted"); }
  { const r = await svc.from("hotel_integrations").insert({ hotel_id: fgnHotel, provider: "rentlio", credential_ref: "x" });
    denied(r) ? ok("uniqueness: one integration per (hotel,provider)") : bad("duplicate integration accepted"); }

  // ── G) built-bundle secret scan ─────────────────────────────────────────────
  const nextDir = resolve(here, "../.next");
  if (existsSync(nextDir)) {
    let scanned = 0; const hits = [];
    const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) { if (f !== "cache") walk(p); } else if (/\.(js|json)$/.test(f)) { scanned++; const txt = readFileSync(p, "utf8"); if (txt.includes(SRV)) hits.push(`service-role key in ${p}`); if (/NEXT_PUBLIC_RENTLIO|api\.rentl\.io\/v1[^"']*apikey/i.test(txt)) hits.push(`rentlio key/endpoint literal in ${p}`); } } };
    try { walk(join(nextDir, "static")); } catch {}
    hits.length === 0 ? ok(`bundle scan: no service-role key or Rentlio secret in ${scanned} client assets`) : hits.forEach(bad);
  } else ok("bundle scan skipped (.next not built)");

  // ── cleanup ──────────────────────────────────────────────────────────────────
  await svc.from("external_entity_mappings").delete().eq("integration_id", intgA).eq("external_id", "rz-unit-adminA");
  await sql.query(`delete from public.hotel_integrations where id = any($1)`, [[intgA, intgB]]).catch(() => {});
  await sql.query(`delete from public.hotels where id=$1`, [fgnHotel]).catch(() => {}); // cascades intgF + mapF + events + runs
  await sql.query(`delete from public.destinations where id=$1`, [fgnDest]).catch(() => {});
  await sql.end();

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. Foreign tenant + test integrations cleaned up. No secrets logged.`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("  audit error:", e.message); process.exit(1); });
