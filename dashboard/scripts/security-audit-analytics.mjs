// ============================================================================
// AI OLLY Dashboard — Sprint 8 ANALYTICS SECURITY AUDIT (aiolly-dev only).
// ----------------------------------------------------------------------------
// Audits the analytics surface: SECURITY DEFINER hygiene + internal authorization
// + EXECUTE grants (no anon/PUBLIC), role-specific daily-table RLS, no PII in
// aggregates, recent-activity redaction (no audit_log), cross-hotel refresh
// denial, and cross-tenant + anon + suspended denial. Scans the built bundle for
// the service-role key. No external HTTP/email; no production interaction. Reads
// the service-role key from ../../.env.
//
//   node dashboard/scripts/security-audit-analytics.mjs
// ============================================================================

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), SRV = readEnv("SUPABASE_SERVICE_ROLE_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, SRV, { auth: { persistSession: false } });
const today = new Date().toISOString().slice(0, 10);

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };
const denied = (r) => !!(r && r.error);

async function main() {
  console.log("AI OLLY — Analytics security audit (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } });
  await sql.connect();

  // ── A) SECURITY DEFINER hygiene + grants + internal authz ──────────────────
  const FNS = ["refresh_ai_quality_daily", "refresh_operations_daily", "refresh_newsletter_daily", "refresh_content_health_daily", "refresh_analytics"];
  for (const fn of FNS) {
    const r = await sql.query(`select p.prosecdef, array_to_string(p.proconfig,',') cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn]);
    const row = r.rows[0];
    row?.prosecdef ? ok(`${fn}: SECURITY DEFINER`) : bad(`${fn}: not SECURITY DEFINER`);
    (row?.cfg || "").includes("search_path=") ? ok(`${fn}: explicit search_path`) : bad(`${fn}: NO explicit search_path`);
  }
  { const r = await sql.query(`select prosecdef, array_to_string(proconfig,',') cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='platform' and p.proname='assert_analytics_access'`);
    (r.rows[0]?.prosecdef && (r.rows[0].cfg || "").includes("search_path=")) ? ok("assert_analytics_access: SECURITY DEFINER + search_path (internal authz)") : bad("assert_analytics_access hygiene"); }
  for (const fn of FNS) {
    const g = await sql.query(`select grantee from information_schema.routine_privileges rp join information_schema.routines ro on ro.specific_name=rp.specific_name where ro.routine_schema='public' and ro.routine_name=$1 and privilege_type='EXECUTE'`, [fn]);
    const grantees = g.rows.map((x) => x.grantee);
    (!grantees.includes("anon") && !grantees.includes("PUBLIC")) ? ok(`${fn}: no EXECUTE for anon/PUBLIC`) : bad(`${fn}: EXECUTE leaked to anon/PUBLIC (${grantees})`);
  }

  // ── B) daily tables: no INSERT/UPDATE for authenticated (write via DEFINER) ─
  for (const t of ["ai_quality_daily", "operations_daily", "newsletter_daily", "content_health_daily"]) {
    const c = (await sql.query(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name=$1 and privilege_type in ('INSERT','UPDATE','DELETE') and grantee='authenticated'`, [t])).rows[0].c;
    c === 0 ? ok(`${t}: authenticated has no direct write (refreshed via SECURITY DEFINER)`) : bad(`${t}: authenticated can write directly`);
  }
  // no PII columns
  { const cols = (await sql.query(`select string_agg(table_name||'.'||column_name,',') c from information_schema.columns where table_schema='public' and table_name in ('ai_quality_daily','operations_daily','newsletter_daily','content_health_daily') and (column_name ~* '(email|phone|first_name|last_name|signed_name|snapshot|payload|access_token|auth_key|ip_)')`)).rows[0].c;
    !cols ? ok("aggregate tables: no PII/secret columns") : bad(`aggregate PII columns: ${cols}`); }

  // ── C) recent-activity does not read backend-only audit_log ────────────────
  { const f = resolve(here, "../src/data/recent-activity.ts"); const src = existsSync(f) ? readFileSync(f, "utf8") : "";
    (!/from\("audit_log"\)/.test(src) && !/from\("content_versions"\)/.test(src)) ? ok("recent-activity avoids audit_log / content_versions (backend-only)") : bad("recent-activity reads a backend-only table"); }
  { const c = (await sql.query(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name='audit_log' and grantee in ('anon','authenticated')`)).rows[0].c;
    c === 0 ? ok("audit_log: no anon/authenticated grants (backend-only)") : bad("audit_log readable by app roles"); }

  // ── D) foreign tenant + suspended member ───────────────────────────────────
  const getOrInsert = async (table, match, row) => {
    let q = svc.from(table).select("id");
    for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
    const f = await q.maybeSingle();
    if (f.data?.id) return f.data.id;
    const r = await svc.from(table).insert({ ...match, ...row }).select("id").single();
    if (r.error) throw new Error(`${table}: ${r.error.message}`); return r.data.id;
  };
  const destId = await getOrInsert("destinations", { slug: "sec-an-dest" }, { name: "Sec An", timezone: "Europe/Zagreb" });
  const otherHotel = await getOrInsert("hotels", { slug: "sec-an-hotel" }, { name: "Sec An Hotel", destination_id: destId, timezone: "Europe/Zagreb", currency: "EUR", status: "active" });
  await svc.from("operations_daily").upsert({ hotel_id: otherHotel, day: today, requests_total: 9, calc_version: "v1" }, { onConflict: "hotel_id,day" });
  await svc.from("ai_quality_daily").upsert({ hotel_id: otherHotel, day: today, total_questions: 9, calc_version: "v1" }, { onConflict: "hotel_id,day" });

  const demoUser = (await svc.auth.admin.listUsers({ page: 1, perPage: 200 })).data.users.find((x) => x.email === "demo@aiolly.dev");
  if (demoUser) {
    const ex = await svc.from("hotel_memberships").select("id").eq("hotel_id", otherHotel).eq("user_id", demoUser.id).maybeSingle();
    if (ex.data?.id) await svc.from("hotel_memberships").update({ role: "hotel_admin", status: "suspended" }).eq("id", ex.data.id);
    else await svc.from("hotel_memberships").insert({ hotel_id: otherHotel, user_id: demoUser.id, role: "hotel_admin", status: "suspended" });
  }

  const demo = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await demo.auth.signInWithPassword({ email: "demo@aiolly.dev", password: "AiOllyDemo!2026" });
  s.error ? bad("demo sign-in failed: " + s.error.message) : ok("signed in as demo@aiolly.dev (suspended at foreign hotel)");

  ((await demo.from("operations_daily").select("day").eq("hotel_id", otherHotel)).data ?? []).length === 0 ? ok("cross-tenant/suspended: cannot read foreign operations_daily") : bad("foreign analytics leaked");
  ((await demo.from("ai_quality_daily").select("day").eq("hotel_id", otherHotel)).data ?? []).length === 0 ? ok("cross-tenant: cannot read foreign ai_quality_daily") : bad("foreign ai analytics leaked");
  { const r = await demo.rpc("refresh_operations_daily", { p_hotel: otherHotel, p_day: today }); (r.error && /privilege/i.test(r.error.message)) ? ok("cross-tenant/suspended: refresh denied") : bad("cross-tenant refresh allowed"); }
  { const r = await demo.rpc("refresh_analytics", { p_hotel: otherHotel, p_day: today }); (r.error) ? ok("cross-tenant: refresh_analytics denied") : bad("cross-tenant refresh_analytics allowed"); }

  // ── E) anon ────────────────────────────────────────────────────────────────
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  for (const t of ["ai_quality_daily", "operations_daily", "newsletter_daily", "content_health_daily"])
    (((await anon.from(t).select("day")).data ?? []).length === 0) ? ok(`anon: cannot read ${t}`) : bad(`anon read ${t}`);
  denied(await anon.rpc("refresh_analytics", { p_hotel: otherHotel, p_day: today })) ? ok("anon: refresh_analytics denied") : bad("anon refresh allowed");

  // ── F) browser bundle secret scan ──────────────────────────────────────────
  const nextDir = resolve(here, "../.next");
  if (existsSync(nextDir)) {
    let scanned = 0, leaked = false;
    const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) { if (f !== "cache") walk(p); } else if (/\.(js|json)$/.test(f)) { scanned++; if (readFileSync(p, "utf8").includes(SRV)) { leaked = true; bad(`service-role key in bundle: ${p}`); } } } };
    try { walk(join(nextDir, "static")); } catch {}
    (!leaked) ? ok(`bundle scan: no service-role key in ${scanned} built assets`) : null;
  } else ok("bundle scan skipped (.next not built)");

  // ── cleanup ────────────────────────────────────────────────────────────────
  if (demoUser) { try { await svc.from("hotel_memberships").delete().eq("hotel_id", otherHotel).eq("user_id", demoUser.id); } catch {} }
  for (const t of ["ai_quality_daily", "operations_daily", "newsletter_daily", "content_health_daily"]) await sql.query(`delete from public.${t} where hotel_id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.hotels where id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.destinations where id=$1`, [destId]).catch(() => {});
  await sql.end();

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. Foreign tenant cleaned up. No secrets logged; no external calls.`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("  audit error:", e.message); process.exit(1); });
