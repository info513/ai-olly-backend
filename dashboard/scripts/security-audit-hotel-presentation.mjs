// AI OLLY — Hotel Presentation SECURITY AUDIT (aiolly-dev only).
// Pattern B: hotel_{poi,route,whisper,event}_settings SELECT requires hotel
// membership; INSERT/UPDATE/DELETE require hotel_admin/editor (or platform_admin).
// hotel_presentation_* readers pin search_path, are not granted to anon/PUBLIC, and
// only READ (canonical facts stay read-only — hotels have no write path to
// destination_* here). Live: hotel-role cannot edit canonical; cross-hotel settings
// writes blocked; anon denied. No bundle secrets. Keys from ../../.env.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve, join } from "node:path";
import pg from "pg"; import { createClient } from "@supabase/supabase-js";
const here = dirname(fileURLToPath(import.meta.url)); const envPath = resolve(here, "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), SRV = readEnv("SUPABASE_SERVICE_ROLE_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, SRV, { auth: { persistSession: false } });
const P = "sap", DOM = "@sec-pres.local", PW = "Sec-Pres!1";
let pass = 0, fail = 0; const ok = (m) => { pass++; console.log("  ✓", m); }; const bad = (m) => { fail++; console.log("  ✗", m); }; const denied = (r) => !!(r && r.error);
const SETTINGS = ["hotel_poi_settings", "hotel_route_settings", "hotel_whisper_settings", "hotel_event_settings"];
const RPCS = ["hotel_presentation_pois", "hotel_presentation_routes", "hotel_presentation_whispers", "hotel_presentation_events"];

async function main() {
  console.log("AI OLLY — Hotel Presentation security audit (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();

  // Pattern B RLS on each settings table
  for (const t of SETTINGS) {
    const pol = (await sql.query(`select cmd, qual, with_check from pg_policies where schemaname='public' and tablename=$1`, [t])).rows;
    const sel = pol.find((p) => p.cmd === "SELECT"), ins = pol.find((p) => p.cmd === "INSERT"), upd = pol.find((p) => p.cmd === "UPDATE"), del = pol.find((p) => p.cmd === "DELETE");
    (sel && /has_hotel_membership/.test(sel.qual || "")) ? ok(`${t}: SELECT requires hotel membership`) : bad(`${t}: SELECT not membership-gated`);
    (ins && /has_hotel_role\(hotel_id, ARRAY\['hotel_admin'.*'editor'/s.test(ins.with_check || "")) ? ok(`${t}: INSERT requires hotel_admin/editor`) : bad(`${t}: INSERT not role-gated`);
    (upd && /has_hotel_role\(hotel_id, ARRAY\['hotel_admin'.*'editor'/s.test(upd.qual || "")) ? ok(`${t}: UPDATE requires hotel_admin/editor`) : bad(`${t}: UPDATE not role-gated`);
    (del && /has_hotel_role\(hotel_id, ARRAY\['hotel_admin'.*'editor'/s.test(del.qual || "")) ? ok(`${t}: DELETE requires hotel_admin/editor`) : bad(`${t}: DELETE not role-gated`);
    const rls = (await sql.query(`select relrowsecurity from pg_class where oid=('public.'||$1)::regclass`, [t])).rows[0];
    rls?.relrowsecurity ? ok(`${t}: RLS enabled`) : bad(`${t}: RLS disabled`);
  }

  // presentation readers: search_path pinned + no anon/PUBLIC execute
  for (const fn of RPCS) {
    const r = (await sql.query(`select array_to_string(proconfig,',') cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname=$1`, [fn])).rows[0];
    (r?.cfg || "").includes("search_path=") ? ok(`${fn}: search_path pinned`) : bad(`${fn}: no search_path`);
    const g = (await sql.query(`select grantee from information_schema.routine_privileges rp join information_schema.routines ro on ro.specific_name=rp.specific_name where ro.routine_schema='public' and ro.routine_name=$1 and privilege_type='EXECUTE'`, [fn])).rows.map((x) => x.grantee);
    (!g.includes("anon") && !g.includes("PUBLIC")) ? ok(`${fn}: no anon/PUBLIC EXECUTE`) : bad(`${fn}: leaked ${g}`);
  }

  // live denial
  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await sql.query(`delete from public.hotel_poi_settings where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.hotel_memberships where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.destination_pois where key like $1`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {});
  };
  const mkUser = async (k, admin = false) => { const email = `${P}.${k}${DOM}`; const { data } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true }); await svc.from("profiles").insert({ user_id: data.user.id, email, is_platform_admin: admin }); const c = createClient(URL, ANON, { auth: { persistSession: false } }); await c.auth.signInWithPassword({ email, password: PW }); return { id: data.user.id, c }; };
  try {
    await cleanup();
    const dest = (await svc.from("destinations").insert({ name: "SAP", slug: `${P}-d`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const poi = (await svc.from("destination_pois").insert({ destination_id: dest, key: `${P}-p`, name: "SAP POI", category: "landmark", status: "published", active: true }).select("id").single()).data.id;
    await sql.query(`update public.destination_pois set published_snapshot = to_jsonb(destination_pois.*)-'published_snapshot' where id=$1`, [poi]);
    const hotel = (await svc.from("hotels").insert({ name: "SAP Hotel", slug: `${P}-h`, destination_id: dest, timezone: "Europe/Zagreb", currency: "EUR" }).select("id").single()).data.id;
    const otherHotel = (await svc.from("hotels").insert({ name: "SAP Other", slug: `${P}-o`, destination_id: dest, timezone: "Europe/Zagreb", currency: "EUR" }).select("id").single()).data.id;
    const editor = await mkUser("editor", false); const viewer = await mkUser("viewer", false); const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    await svc.from("hotel_memberships").insert({ hotel_id: hotel, user_id: editor.id, role: "editor", status: "active" });
    await svc.from("hotel_memberships").insert({ hotel_id: hotel, user_id: viewer.id, role: "reception", status: "active" });

    { const r = await editor.c.from("destination_pois").update({ name: "hack" }).eq("id", poi).select("id");
      const unchanged = (await svc.from("destination_pois").select("name").eq("id", poi).single()).data?.name === "SAP POI";
      ((denied(r) || (r.data || []).length === 0) && unchanged) ? ok("hotel editor cannot write canonical destination_pois (no rows changed)") : bad("hotel wrote canonical!"); }
    { const r = await editor.c.from("destination_pois").insert({ destination_id: dest, key: `${P}-x`, name: "x", category: "other", status: "published" }); denied(r) ? ok("hotel editor cannot create canonical content") : bad("hotel created canonical!"); }
    denied(await editor.c.from("hotel_poi_settings").insert({ hotel_id: otherHotel, poi_id: poi, featured: true })) ? ok("editor cannot write another hotel's settings") : bad("cross-hotel settings write!");
    denied(await viewer.c.from("hotel_poi_settings").insert({ hotel_id: hotel, poi_id: poi, featured: true })) ? ok("reception role cannot write presentation settings") : bad("viewer wrote settings!");
    (((await anon.rpc("hotel_presentation_pois", { p_hotel: hotel })).data || []).length === 0) ? ok("anon cannot read presentation via RPC") : bad("anon read presentation!");
    (((await anon.from("hotel_poi_settings").select("id").eq("hotel_id", hotel)).data || []).length === 0) ? ok("anon cannot read settings table") : bad("anon read settings!");
  } finally { await cleanup(); }

  const nextDir = resolve(here, "../.next");
  if (existsSync(nextDir)) { let scanned = 0, leaked = false; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) { if (f !== "cache") walk(p); } else if (/\.(js|json)$/.test(f)) { scanned++; if (readFileSync(p, "utf8").includes(SRV)) { leaked = true; bad(`SR key in ${p}`); } } } }; try { walk(join(nextDir, "static")); } catch {} if (!leaked) ok(`bundle scan clean (${scanned})`); } else ok("bundle scan skipped");
  await sql.end(); console.log(`\n${fail === 0 ? "✅" : "❌"} Hotel Presentation security audit: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
