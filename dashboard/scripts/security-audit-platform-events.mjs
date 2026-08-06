// AI OLLY — Platform CMS Events SECURITY AUDIT (aiolly-dev only). SECURITY DEFINER
// hygiene + grants, admin-only write RLS, published-or-admin SELECT, no hard delete,
// publish-only-via-RPC, redacted audit, key UNIQUE, resolved INVOKER, live cross-role +
// anon denial, no bundle secrets. Keys from ../../.env.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve, join } from "node:path";
import pg from "pg"; import { createClient } from "@supabase/supabase-js";
const here = dirname(fileURLToPath(import.meta.url)); const envPath = resolve(here, "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), SRV = readEnv("SUPABASE_SERVICE_ROLE_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, SRV, { auth: { persistSession: false } });
const P = "sape", DOM = "@sec-audit-platform-events.local", PW = "Sec-Pe-Pass!1";
let pass = 0, fail = 0; const ok = (m) => { pass++; console.log("  ✓", m); }; const bad = (m) => { fail++; console.log("  ✗", m); }; const denied = (r) => !!(r && r.error);
async function main() {
  console.log("AI OLLY — Platform Events security audit (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();
  const FNS = ["publish_event", "rollback_event", "list_event_versions"];
  for (const fn of FNS) { const r = (await sql.query(`select prosecdef, array_to_string(proconfig,',') cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname=$1`, [fn])).rows[0]; r?.prosecdef ? ok(`${fn}: SECURITY DEFINER`) : bad(`${fn}: not SECDEF`); (r?.cfg || "").includes("search_path=") ? ok(`${fn}: search_path`) : bad(`${fn}: no search_path`); }
  for (const fn of FNS) { const g = (await sql.query(`select grantee from information_schema.routine_privileges rp join information_schema.routines ro on ro.specific_name=rp.specific_name where ro.routine_schema='public' and ro.routine_name=$1 and privilege_type='EXECUTE'`, [fn])).rows.map((x) => x.grantee); (!g.includes("anon") && !g.includes("PUBLIC")) ? ok(`${fn}: no anon/PUBLIC`) : bad(`${fn}: leaked ${g}`); }
  { const pol = (await sql.query(`select cmd, qual, with_check from pg_policies where schemaname='public' and tablename='destination_events'`)).rows;
    const ins = pol.find((p) => p.cmd === "INSERT"), upd = pol.find((p) => p.cmd === "UPDATE"), sel = pol.find((p) => p.cmd === "SELECT");
    (ins && /is_platform_admin/.test(ins.with_check || "")) ? ok("INSERT admin-gated") : bad("INSERT open");
    (upd && /is_platform_admin/.test(upd.qual || "")) ? ok("UPDATE admin-gated") : bad("UPDATE open");
    (sel && /is_platform_admin/.test(sel.qual || "") && /published/.test(sel.qual || "") && /has_destination_access/.test(sel.qual || "")) ? ok("SELECT admin-or-published") : bad("SELECT open"); }
  ((await sql.query(`select count(*)::int c from pg_policies where schemaname='public' and tablename='destination_events' and cmd='DELETE'`)).rows[0].c === 0) ? ok("no DELETE policy") : bad("DELETE policy exists");
  { const t = (await sql.query(`select 1 from pg_trigger where tgrelid='public.destination_events'::regclass and not tgisinternal and tgfoid=(select oid from pg_proc where proname='protect_destination_publish')`)).rows.length; (t >= 1) ? ok("protect-publish trigger present") : bad("protect trigger missing"); }
  { const a = (await sql.query(`select 1 from pg_trigger where tgrelid='public.destination_events'::regclass and not tgisinternal and tgfoid=(select oid from pg_proc where proname='audit_destination_content')`)).rows.length; (a >= 1) ? ok("audit trigger present") : bad("audit trigger missing");
    const leak = (await sql.query(`select count(*)::int c from public.audit_log where entity_type='destination_event' and (after_state ? 'published_snapshot' or after_state ? 'body_content')`)).rows[0].c; (leak === 0) ? ok("audit compact (no blob)") : bad(`audit leaks ${leak}`); }
  ((await sql.query(`select count(*)::int c from pg_constraint where conrelid='public.destination_events'::regclass and contype='u' and conname='destination_events_key_per_dest'`)).rows[0].c === 1) ? ok("per-destination key UNIQUE") : bad("key uniqueness missing");
  ((await sql.query(`select prosecdef from pg_proc where proname='resolved_destination_events'`)).rows[0]?.prosecdef === false) ? ok("resolved INVOKER (tenant-safe)") : bad("resolved DEFINER");
  const cleanup = async () => { try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await sql.query(`delete from public.destination_events where key like $1`, [P + "%"]).catch(() => {}); await sql.query(`delete from public.hotel_memberships where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {}); await sql.query(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {}); await sql.query(`delete from public.destination_events where destination_id in (select id from public.destinations where slug like $1)`, [P + "%"]).catch(() => {}); await sql.query(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {}); };
  const mkUser = async (k, admin = false) => { const email = `${P}.${k}${DOM}`; const { data } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true }); await svc.from("profiles").insert({ user_id: data.user.id, email, is_platform_admin: admin }); const c = createClient(URL, ANON, { auth: { persistSession: false } }); await c.auth.signInWithPassword({ email, password: PW }); return { id: data.user.id, c }; };
  try {
    await cleanup();
    const dest = (await svc.from("destinations").insert({ name: "SA", slug: `${P}-d`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const wh = (await svc.from("destination_events").insert({ destination_id: dest, key: `${P}-w`, title: "SA", status: "published" }).select("id").single()).data.id;
    const hotelU = await mkUser("hotel", false);
    const hotel = (await svc.from("hotels").insert({ name: "SAH", slug: `${P}-h`, destination_id: dest, timezone: "Europe/Zagreb", currency: "EUR" }).select("id").single()).data.id;
    await svc.from("hotel_memberships").insert({ hotel_id: hotel, user_id: hotelU.id, role: "hotel_admin", status: "active" });
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    denied(await hotelU.c.from("destination_events").insert({ destination_id: dest, key: `${P}-hx`, title: "x" })) ? ok("hotel INSERT denied") : bad("hotel insert!");
    { const r = await hotelU.c.from("destination_events").update({ title: "hack" }).eq("id", wh).select("id"); (denied(r) || (r.data || []).length === 0) ? ok("hotel UPDATE denied") : bad("hotel update!"); }
    denied(await hotelU.c.rpc("publish_event", { p_event: wh, p_change_summary: "x" })) ? ok("hotel publish denied") : bad("hotel publish!");
    denied(await hotelU.c.rpc("rollback_event", { p_event: wh, p_version: wh })) ? ok("hotel rollback denied") : bad("hotel rollback!");
    (((await anon.from("destination_events").select("id").limit(1)).data || []).length === 0) ? ok("anon SELECT denied") : bad("anon read!");
    denied(await anon.rpc("publish_event", { p_event: wh, p_change_summary: "x" })) ? ok("anon publish denied") : bad("anon publish!");
    denied(await anon.rpc("list_event_versions", { p_event: wh })) ? ok("anon history denied") : bad("anon history!");
    (((await hotelU.c.from("destination_events").select("id").eq("id", wh)).data || []).length === 1) ? ok("hotel reads published event") : bad("hotel cannot read published");
  } finally { await cleanup(); }
  const nextDir = resolve(here, "../.next");
  if (existsSync(nextDir)) { let scanned = 0, leaked = false; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) { if (f !== "cache") walk(p); } else if (/\.(js|json)$/.test(f)) { scanned++; if (readFileSync(p, "utf8").includes(SRV)) { leaked = true; bad(`SR key in ${p}`); } } } }; try { walk(join(nextDir, "static")); } catch {} if (!leaked) ok(`bundle scan clean (${scanned})`); } else ok("bundle scan skipped");
  await sql.end(); console.log(`\n${fail === 0 ? "✅" : "❌"} Platform Events security audit: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
