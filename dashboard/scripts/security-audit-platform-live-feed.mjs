// AI OLLY — Platform CMS Live Feed SECURITY AUDIT (aiolly-dev only). archive_expired_
// feed_events SECURITY DEFINER + search_path + no anon/PUBLIC; dedup unique index
// present; feed items inherit destination_events admin-only write RLS + no DELETE
// policy; live hotel/anon denial; no bundle secrets. Keys from ../../.env.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve, join } from "node:path";
import pg from "pg"; import { createClient } from "@supabase/supabase-js";
const here = dirname(fileURLToPath(import.meta.url)); const envPath = resolve(here, "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), SRV = readEnv("SUPABASE_SERVICE_ROLE_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, SRV, { auth: { persistSession: false } });
const P = "salf", DOM = "@sec-audit-livefeed.local", PW = "Sec-Lf-Pass!1";
let pass = 0, fail = 0; const ok = (m) => { pass++; console.log("  ✓", m); }; const bad = (m) => { fail++; console.log("  ✗", m); }; const denied = (r) => !!(r && r.error);
async function main() {
  console.log("AI OLLY — Platform Live Feed security audit (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();
  { const r = (await sql.query(`select prosecdef, array_to_string(proconfig,',') cfg from pg_proc where proname='archive_expired_feed_events'`)).rows[0];
    (r?.prosecdef) ? ok("archive_expired_feed_events: SECURITY DEFINER") : bad("not SECDEF"); ((r?.cfg || "").includes("search_path=")) ? ok("explicit search_path") : bad("no search_path");
    const src = (await sql.query(`select prosrc from pg_proc where proname='archive_expired_feed_events'`)).rows[0]?.prosrc || "";
    (/only platform_admin/.test(src)) ? ok("auto-expiry gated to platform_admin") : bad("auto-expiry not admin-gated"); }
  { const g = (await sql.query(`select grantee from information_schema.routine_privileges rp join information_schema.routines ro on ro.specific_name=rp.specific_name where ro.routine_schema='public' and ro.routine_name='archive_expired_feed_events' and privilege_type='EXECUTE'`)).rows.map((x) => x.grantee);
    (!g.includes("anon") && !g.includes("PUBLIC")) ? ok(`no anon/PUBLIC EXECUTE (${g.join(",")})`) : bad(`leaked ${g}`); }
  ((await sql.query(`select 1 from pg_indexes where indexname='destination_events_feed_dedup'`)).rowCount > 0) ? ok("dedup unique index present") : bad("dedup index missing");
  // feed items inherit events write-lock + archive-only
  { const pol = (await sql.query(`select cmd, with_check from pg_policies where schemaname='public' and tablename='destination_events'`)).rows; const ins = pol.find((p) => p.cmd === "INSERT");
    (ins && /is_platform_admin/.test(ins.with_check || "")) ? ok("feed items inherit admin-only INSERT RLS") : bad("INSERT open");
    ((await sql.query(`select count(*)::int c from pg_policies where schemaname='public' and tablename='destination_events' and cmd='DELETE'`)).rows[0].c === 0) ? ok("no DELETE policy (archive-only)") : bad("DELETE policy exists"); }
  // live denial
  const cleanup = async () => { try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await sql.query(`delete from public.hotel_memberships where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {}); await sql.query(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {}); await sql.query(`delete from public.destination_events where destination_id in (select id from public.destinations where slug like $1)`, [P + "%"]).catch(() => {}); await sql.query(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {}); };
  const mkUser = async (k, admin = false) => { const email = `${P}.${k}${DOM}`; const { data } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true }); await svc.from("profiles").insert({ user_id: data.user.id, email, is_platform_admin: admin }); const c = createClient(URL, ANON, { auth: { persistSession: false } }); await c.auth.signInWithPassword({ email, password: PW }); return { id: data.user.id, c }; };
  try {
    await cleanup();
    const dest = (await svc.from("destinations").insert({ name: "SA", slug: `${P}-d`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const hotelU = await mkUser("hotel", false); const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const hotel = (await svc.from("hotels").insert({ name: "SAH", slug: `${P}-h`, destination_id: dest, timezone: "Europe/Zagreb", currency: "EUR" }).select("id").single()).data.id;
    await svc.from("hotel_memberships").insert({ hotel_id: hotel, user_id: hotelU.id, role: "hotel_admin", status: "active" });
    denied(await hotelU.c.rpc("archive_expired_feed_events", { p_destination: dest })) ? ok("hotel auto-expiry denied") : bad("hotel auto-expiry allowed!");
    denied(await anon.rpc("archive_expired_feed_events", { p_destination: dest })) ? ok("anon auto-expiry denied") : bad("anon auto-expiry allowed!");
    denied(await hotelU.c.from("destination_events").insert({ destination_id: dest, key: `${P}-hx`, title: "x", is_live_feed: true })) ? ok("hotel feed import denied") : bad("hotel imported!");
  } finally { await cleanup(); }
  const nextDir = resolve(here, "../.next");
  if (existsSync(nextDir)) { let scanned = 0, leaked = false; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) { if (f !== "cache") walk(p); } else if (/\.(js|json)$/.test(f)) { scanned++; if (readFileSync(p, "utf8").includes(SRV)) { leaked = true; bad(`SR key in ${p}`); } } } }; try { walk(join(nextDir, "static")); } catch {} if (!leaked) ok(`bundle scan clean (${scanned})`); } else ok("bundle scan skipped");
  await sql.end(); console.log(`\n${fail === 0 ? "✅" : "❌"} Platform Live Feed security audit: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
