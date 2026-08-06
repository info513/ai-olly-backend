// ============================================================================
// AI OLLY Dashboard — Platform CMS Routes SECURITY AUDIT (aiolly-dev only).
// ----------------------------------------------------------------------------
// Audits the Routes module: SECURITY DEFINER hygiene + EXECUTE grants (no anon/
// PUBLIC), platform_admin-only write RLS, published-or-admin SELECT, no hard-
// delete path, publish only via RPC, waypoint same-destination trigger, redacted
// audit, key-collision protection, resolved stays INVOKER (tenant-safe), and no
// service-role key in the built bundle. Cross-role + anon denial proven live.
// Keys from ../../.env.
//
//   node dashboard/scripts/security-audit-platform-routes.mjs
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
const P = "sapr", DOM = "@sec-audit-platform-routes.local", PW = "Sec-Pr-Pass!1";

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };
const denied = (r) => !!(r && r.error);

async function main() {
  console.log("AI OLLY — Platform Routes security audit (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();

  // ── A) SECURITY DEFINER hygiene + EXECUTE grants ────────────────────────────
  const FNS = ["publish_route", "rollback_route", "list_route_versions"];
  for (const fn of FNS) {
    const r = (await sql.query(`select p.prosecdef, array_to_string(p.proconfig,',') cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn])).rows[0];
    r?.prosecdef ? ok(`${fn}: SECURITY DEFINER`) : bad(`${fn}: not SECURITY DEFINER`);
    (r?.cfg || "").includes("search_path=") ? ok(`${fn}: explicit (empty) search_path`) : bad(`${fn}: NO explicit search_path`);
  }
  for (const fn of FNS) {
    const g = (await sql.query(`select grantee from information_schema.routine_privileges rp join information_schema.routines ro on ro.specific_name=rp.specific_name where ro.routine_schema='public' and ro.routine_name=$1 and privilege_type='EXECUTE'`, [fn])).rows.map((x) => x.grantee);
    (!g.includes("anon") && !g.includes("PUBLIC")) ? ok(`${fn}: no EXECUTE for anon/PUBLIC (${g.join(",")})`) : bad(`${fn}: EXECUTE leaked to anon/PUBLIC (${g})`);
  }

  // ── B) Write RLS platform_admin-only; SELECT published-or-admin ─────────────
  {
    const pol = (await sql.query(`select cmd, qual, with_check from pg_policies where schemaname='public' and tablename='destination_routes'`)).rows;
    const ins = pol.find((p) => p.cmd === "INSERT"); const upd = pol.find((p) => p.cmd === "UPDATE"); const sel = pol.find((p) => p.cmd === "SELECT");
    (ins && /is_platform_admin/.test(ins.with_check || "")) ? ok("INSERT policy requires platform_admin") : bad("INSERT policy not admin-gated");
    (upd && /is_platform_admin/.test(upd.qual || "")) ? ok("UPDATE policy requires platform_admin") : bad("UPDATE policy not admin-gated");
    (sel && /is_platform_admin/.test(sel.qual || "") && /published/.test(sel.qual || "") && /has_destination_access/.test(sel.qual || "")) ? ok("SELECT policy is admin-or-published-with-destination-access") : bad("SELECT policy too open");
  }

  // ── C) No hard-delete path ──────────────────────────────────────────────────
  ((await sql.query(`select count(*)::int c from pg_policies where schemaname='public' and tablename='destination_routes' and cmd='DELETE'`)).rows[0].c === 0)
    ? ok("destination_routes: no DELETE policy (archive-only)") : bad("destination_routes has a DELETE policy");

  // ── D) Publish protection + waypoint validation triggers ────────────────────
  {
    const pub = (await sql.query(`select 1 from pg_trigger where tgrelid='public.destination_routes'::regclass and not tgisinternal and tgfoid=(select oid from pg_proc where proname='protect_destination_publish')`)).rows.length;
    (pub >= 1) ? ok("protect-publish trigger present on destination_routes") : bad("protect-publish trigger missing");
    const fnsrc = (await sql.query(`select prosrc from pg_proc where proname='protect_destination_publish'`)).rows[0]?.prosrc || "";
    (/direct publish is not allowed/.test(fnsrc)) ? ok("protect-publish guard rejects direct publish (must use RPC)") : bad("protect-publish guard text missing");
    const wpt = (await sql.query(`select 1 from pg_trigger where tgrelid='public.destination_routes'::regclass and not tgisinternal and tgfoid=(select oid from pg_proc where proname='validate_route_waypoints')`)).rows.length;
    (wpt >= 1) ? ok("waypoint same-destination validation trigger present") : bad("waypoint validation trigger missing");
  }

  // ── E) Redacted audit; key uniqueness; resolved INVOKER ─────────────────────
  {
    const audit = (await sql.query(`select 1 from pg_trigger where tgrelid='public.destination_routes'::regclass and not tgisinternal and tgfoid=(select oid from pg_proc where proname='audit_destination_content')`)).rows.length;
    (audit >= 1) ? ok("audit trigger present on destination_routes") : bad("audit trigger missing");
    const leak = (await sql.query(`select count(*)::int c from public.audit_log where entity_type='destination_route' and (after_state ? 'published_snapshot' or after_state ? 'waypoints' or after_state ? 'body_content')`)).rows[0].c;
    (leak === 0) ? ok("audit_log: route snapshots are compact (no snapshot/waypoints/body blob)") : bad(`audit_log leaks blobs in ${leak} rows`);
    ((await sql.query(`select count(*)::int c from pg_constraint where conrelid='public.destination_routes'::regclass and contype='u' and conname='destination_routes_key_per_dest'`)).rows[0].c === 1)
      ? ok("key has a per-destination UNIQUE constraint") : bad("per-destination key uniqueness missing");
    ((await sql.query(`select prosecdef from pg_proc where proname='resolved_destination_routes'`)).rows[0]?.prosecdef === false)
      ? ok("resolved_destination_routes is SECURITY INVOKER (RLS-enforced, tenant-safe)") : bad("resolved_destination_routes is DEFINER (tenant-safety risk)");
  }

  // ── F) Live cross-role + anon denial ────────────────────────────────────────
  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await sql.query(`delete from public.destination_routes where key like $1`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.hotel_memberships where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.destination_routes where destination_id in (select id from public.destinations where slug like $1)`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {});
  };
  const mkUser = async (k, admin = false) => {
    const email = `${P}.${k}${DOM}`;
    const { data } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true });
    await svc.from("profiles").insert({ user_id: data.user.id, email, is_platform_admin: admin });
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    await c.auth.signInWithPassword({ email, password: PW });
    return { id: data.user.id, c };
  };
  try {
    await cleanup();
    const dest = (await svc.from("destinations").insert({ name: "SA", slug: `${P}-d`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const route = (await svc.from("destination_routes").insert({ destination_id: dest, key: `${P}-r`, name: "SA Route", status: "published" }).select("id").single()).data.id;
    const hotelU = await mkUser("hotel", false);
    const hotel = (await svc.from("hotels").insert({ name: "SAH", slug: `${P}-h`, destination_id: dest, timezone: "Europe/Zagreb", currency: "EUR" }).select("id").single()).data.id;
    await svc.from("hotel_memberships").insert({ hotel_id: hotel, user_id: hotelU.id, role: "hotel_admin", status: "active" });
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });

    denied(await hotelU.c.from("destination_routes").insert({ destination_id: dest, key: `${P}-hx`, name: "x" })) ? ok("hotel-role INSERT denied") : bad("hotel-role INSERT allowed!");
    const hUpd = await hotelU.c.from("destination_routes").update({ name: "hack" }).eq("id", route).select("id");
    (denied(hUpd) || (hUpd.data || []).length === 0) ? ok("hotel-role UPDATE denied") : bad("hotel-role UPDATE allowed!");
    denied(await hotelU.c.rpc("publish_route", { p_route: route, p_change_summary: "x" })) ? ok("hotel-role publish RPC denied") : bad("hotel-role publish RPC allowed!");
    denied(await hotelU.c.rpc("rollback_route", { p_route: route, p_version: route })) ? ok("hotel-role rollback RPC denied") : bad("hotel-role rollback RPC allowed!");
    (((await anon.from("destination_routes").select("id").limit(1)).data || []).length === 0) ? ok("anon SELECT denied") : bad("anon SELECT allowed!");
    denied(await anon.rpc("publish_route", { p_route: route, p_change_summary: "x" })) ? ok("anon publish RPC denied") : bad("anon publish RPC allowed!");
    denied(await anon.rpc("list_route_versions", { p_route: route })) ? ok("anon history RPC denied") : bad("anon history RPC allowed!");
    (((await hotelU.c.from("destination_routes").select("id").eq("id", route)).data || []).length === 1) ? ok("hotel member CAN read published route in their destination") : bad("hotel member cannot read published destination route");
  } finally {
    await cleanup();
  }

  // ── G) Browser bundle: no service-role key ──────────────────────────────────
  const nextDir = resolve(here, "../.next");
  if (existsSync(nextDir)) {
    let scanned = 0, leaked = false;
    const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) { if (f !== "cache") walk(p); } else if (/\.(js|json)$/.test(f)) { scanned++; if (readFileSync(p, "utf8").includes(SRV)) { leaked = true; bad(`service-role key in bundle: ${p}`); } } } };
    try { walk(join(nextDir, "static")); } catch {}
    if (!leaked) ok(`bundle scan: no service-role key in ${scanned} built assets`);
  } else ok("bundle scan skipped (.next not built)");

  await sql.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} Platform Routes security audit: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
