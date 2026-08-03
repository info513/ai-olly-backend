// ============================================================================
// AI OLLY Dashboard — Sprint 3.1 SECURITY AUDIT (aiolly-dev only).
// ----------------------------------------------------------------------------
// Audits the Content module's DB surface and attempts to bypass every RPC /
// table from a DIFFERENT tenant and from anon. Creates a throwaway "other hotel"
// the demo user is NOT a member of, then verifies denial. Cleans up. Reads the
// service-role key from ../../.env at runtime (never committed).
//
//   node dashboard/scripts/security-audit-content.mjs
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => {
  const line = readFileSync(envPath, "utf8").split("\n").find((l) => l.startsWith(k + "="));
  if (!line) throw new Error(`Missing ${k}`); return line.slice(k.length + 1).trim().replace(/^["']|["']$/g, "");
};
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), SRV = readEnv("SUPABASE_SERVICE_ROLE_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, SRV, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };
const denied = (r) => !!(r && r.error);

async function main() {
  console.log("AI OLLY — Content security audit (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } });
  await sql.connect();

  // ── A) catalog: SECURITY DEFINER hygiene + grants ──────────────────────────
  const DEFINER_FNS = ["publish_hotel_service", "rollback_hotel_service", "list_service_versions"];
  for (const fn of DEFINER_FNS) {
    const r = await sql.query(
      `select p.prosecdef, array_to_string(p.proconfig,',') cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn]);
    const row = r.rows[0];
    row?.prosecdef ? ok(`${fn}: SECURITY DEFINER`) : bad(`${fn}: not SECURITY DEFINER`);
    (row?.cfg || "").includes("search_path=") ? ok(`${fn}: explicit search_path (${row.cfg})`) : bad(`${fn}: NO explicit search_path`);
  }
  // resolved is SECURITY INVOKER (RLS applies)
  {
    const r = await sql.query(`select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='resolved_hotel_services'`);
    r.rows[0] && !r.rows[0].prosecdef ? ok("resolved_hotel_services: SECURITY INVOKER (caller RLS applies)") : bad("resolved_hotel_services: unexpectedly DEFINER");
  }
  // EXECUTE grants: authenticated/service_role only, never anon/public
  for (const fn of [...DEFINER_FNS, "resolved_hotel_services"]) {
    const g = await sql.query(
      `select grantee, privilege_type from information_schema.routine_privileges rp
       join information_schema.routines ro on ro.specific_name=rp.specific_name
       where ro.routine_schema='public' and ro.routine_name=$1 and privilege_type='EXECUTE'`, [fn]);
    const grantees = g.rows.map((x) => x.grantee);
    (!grantees.includes("anon") && !grantees.includes("PUBLIC")) ? ok(`${fn}: no EXECUTE for anon/PUBLIC`) : bad(`${fn}: EXECUTE leaked to anon/PUBLIC (${grantees})`);
  }
  // content_versions must stay closed to app roles (Step 1 invariant intact)
  {
    const pol = (await sql.query(`select count(*)::int c from pg_policies where schemaname='public' and tablename='content_versions'`)).rows[0].c;
    const gr = (await sql.query(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name='content_versions' and grantee in ('anon','authenticated')`)).rows[0].c;
    pol === 0 ? ok("content_versions: still 0 RLS policies (Step 1 invariant)") : bad(`content_versions: ${pol} policies added`);
    gr === 0 ? ok("content_versions: no anon/authenticated grants (read only via SECURITY DEFINER fn)") : bad("content_versions: grants leaked");
  }
  // rooms.access_token never selectable by authenticated
  {
    const c = (await sql.query(`select count(*)::int c from information_schema.column_privileges where table_schema='public' and table_name='rooms' and column_name='access_token' and privilege_type='SELECT' and grantee in ('authenticated','anon')`)).rows[0].c;
    c === 0 ? ok("rooms.access_token: not SELECTable by anon/authenticated") : bad("rooms.access_token selectable");
  }

  // ── B) create a foreign tenant the demo user is NOT a member of ────────────
  // (select-then-insert; several Content tables use partial unique indexes, so
  //  onConflict upsert is not usable)
  const getOrInsert = async (table, match, row) => {
    let q = svc.from(table).select("id");
    for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
    const f = await q.maybeSingle();
    if (f.data?.id) return f.data.id;
    const r = await svc.from(table).insert({ ...match, ...row }).select("id").single();
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    return r.data.id;
  };
  const destId = await getOrInsert("destinations", { slug: "sec-other-dest" }, { name: "Sec Other", timezone: "Europe/Zagreb" });
  const otherHotel = await getOrInsert("hotels", { slug: "sec-other-hotel" }, { name: "Sec Other Hotel", destination_id: destId, timezone: "Europe/Zagreb", currency: "EUR", status: "active" });
  const cat = await getOrInsert("service_categories", { hotel_id: otherHotel, key: "sec-cat" }, { name: "Sec" });
  const otherSvc = await getOrInsert("hotel_services", { hotel_id: otherHotel, key: "sec-secret" }, { category_id: cat, title: "Secret Service", body_content: { version: 1, blocks: [{ type: "paragraph", text: "secret" }] }, status: "published", published_at: new Date().toISOString(), published_snapshot: { title: "Secret Service", key: "sec-secret", source_type: "hotel", active: true, visible_in_pwa: true, visible_in_web: false, available_to_ai: true, sort_order: 0, category_id: cat, body_content: { version: 1, blocks: [{ type: "paragraph", text: "secret" }] } } });
  const rt = await getOrInsert("room_types", { hotel_id: otherHotel, slug: "sec-rt" }, { name: "Sec RT" });
  const otherRoom = await getOrInsert("rooms", { hotel_id: otherHotel, room_number: "SEC1" }, { room_type_id: rt, access_token: "SEC-SECRET-TOKEN" });
  // a version for the foreign service (for list_service_versions denial)
  const vExists = (await svc.from("content_versions").select("id").eq("entity_type", "hotel_service").eq("entity_id", otherSvc).maybeSingle()).data;
  if (!vExists) await svc.from("content_versions").insert({ entity_type: "hotel_service", entity_id: otherSvc, version_number: 1, status: "published", snapshot: { title: "Secret" }, hotel_id: otherHotel, published_at: new Date().toISOString() });
  const otherVersionId = (await svc.from("content_versions").select("id").eq("entity_type", "hotel_service").eq("entity_id", otherSvc).limit(1).single()).data.id;

  // ── C) sign in as the demo user (member of demo+antique, NOT the foreign hotel)
  const demo = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await demo.auth.signInWithPassword({ email: "demo@aiolly.dev", password: "AiOllyDemo!2026" });
  if (s.error) { bad("demo sign-in failed: " + s.error.message); }
  else ok("signed in as demo@aiolly.dev (non-member of foreign hotel)");

  // reads: foreign hotel content must be invisible
  ((await demo.from("hotel_services").select("id").eq("id", otherSvc)).data ?? []).length === 0 ? ok("cross-tenant: cannot read foreign hotel service") : bad("cross-tenant service READ leaked");
  ((await demo.from("rooms").select("id").eq("id", otherRoom)).data ?? []).length === 0 ? ok("cross-tenant: cannot read foreign hotel room") : bad("cross-tenant room READ leaked");
  ((await demo.from("room_types").select("id").eq("id", rt)).data ?? []).length === 0 ? ok("cross-tenant: cannot read foreign room type") : bad("cross-tenant room type leaked");

  // writes / RPCs against the foreign tenant must be denied
  denied(await demo.from("hotel_services").update({ title: "HACKED" }).eq("id", otherSvc)) || (await svc.from("hotel_services").select("title").eq("id", otherSvc).single()).data.title === "Secret Service"
    ? ok("cross-tenant: cannot UPDATE foreign service") : bad("cross-tenant service UPDATE succeeded");
  { const r = await demo.rpc("publish_hotel_service", { p_service: otherSvc, p_acknowledge_critical: true }); (r.error && /privilege/i.test(r.error.message)) ? ok("cross-tenant: publish_hotel_service denied") : bad("cross-tenant publish allowed"); }
  { const r = await demo.rpc("rollback_hotel_service", { p_service: otherSvc, p_version: otherVersionId }); (r.error) ? ok("cross-tenant: rollback_hotel_service denied") : bad("cross-tenant rollback allowed"); }
  { const r = await demo.rpc("list_service_versions", { p_service: otherSvc }); (r.error && /privilege/i.test(r.error.message)) ? ok("cross-tenant: list_service_versions denied") : bad(`cross-tenant history leaked: ${JSON.stringify(r.data)}`); }
  { const r = await demo.rpc("resolved_hotel_services", { p_hotel: otherHotel }); const ids = (r.data ?? []).map((x) => x.service_id); (!ids.includes(otherSvc)) ? ok("cross-tenant: resolved_hotel_services hides foreign hotel-owned service") : bad("cross-tenant resolved leaked hotel service"); }
  // token never reachable, even by explicit column select (own hotel included)
  denied(await demo.from("rooms").select("access_token").limit(1)) ? ok("access_token: explicit column select denied for member") : bad("access_token READ leaked");

  // ── D) anon (no login) cannot call any Content RPC ─────────────────────────
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  for (const [fn, args] of [["publish_hotel_service", { p_service: otherSvc }], ["rollback_hotel_service", { p_service: otherSvc, p_version: otherVersionId }], ["list_service_versions", { p_service: otherSvc }]]) {
    const r = await anon.rpc(fn, args);
    denied(r) ? ok(`anon: ${fn} denied`) : bad(`anon: ${fn} allowed`);
  }
  (((await anon.from("hotel_services").select("id")).data ?? []).length === 0) ? ok("anon: cannot read hotel_services") : bad("anon read services");
  (((await anon.from("rooms").select("id")).data ?? []).length === 0) ? ok("anon: cannot read rooms") : bad("anon read rooms");

  // ── cleanup foreign tenant ─────────────────────────────────────────────────
  await sql.query(`delete from public.content_versions where entity_id=$1`, [otherSvc]).catch(() => {});
  await sql.query(`delete from public.audit_log where hotel_id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.rooms where hotel_id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.room_types where hotel_id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.hotel_services where hotel_id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.service_categories where hotel_id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.hotels where id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.destinations where id=$1`, [destId]).catch(() => {});
  await sql.end();

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. Foreign tenant cleaned up. No secrets logged.`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("  audit error:", e.message); process.exit(1); });
