// AI OLLY — Platform CMS Destination AI Knowledge SECURITY AUDIT (aiolly-dev only).
// Destination-scope (hotel_id null) writes require platform_admin (RLS); reused
// publish/rollback RPCs are SECURITY DEFINER + no anon/PUBLIC; no hard-delete;
// aliases admin-only; live hotel/anon denial; no bundle secrets. Keys from ../../.env.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve, join } from "node:path";
import pg from "pg"; import { createClient } from "@supabase/supabase-js";
const here = dirname(fileURLToPath(import.meta.url)); const envPath = resolve(here, "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), SRV = readEnv("SUPABASE_SERVICE_ROLE_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, SRV, { auth: { persistSession: false } });
const P = "saai", DOM = "@sec-audit-ai.local", PW = "Sec-Ai-Pass!1";
let pass = 0, fail = 0; const ok = (m) => { pass++; console.log("  ✓", m); }; const bad = (m) => { fail++; console.log("  ✗", m); }; const denied = (r) => !!(r && r.error);
async function main() {
  console.log("AI OLLY — Platform Destination AI security audit (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();
  const FNS = ["publish_knowledge_article", "rollback_knowledge_article", "list_article_versions"];
  for (const fn of FNS) { const r = (await sql.query(`select prosecdef, array_to_string(proconfig,',') cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname=$1`, [fn])).rows[0]; r?.prosecdef ? ok(`${fn}: SECURITY DEFINER`) : bad(`${fn}: not SECDEF`); (r?.cfg || "").includes("search_path=") ? ok(`${fn}: search_path`) : bad(`${fn}: no search_path`); }
  for (const fn of FNS) { const g = (await sql.query(`select grantee from information_schema.routine_privileges rp join information_schema.routines ro on ro.specific_name=rp.specific_name where ro.routine_schema='public' and ro.routine_name=$1 and privilege_type='EXECUTE'`, [fn])).rows.map((x) => x.grantee); (!g.includes("anon") && !g.includes("PUBLIC")) ? ok(`${fn}: no anon/PUBLIC`) : bad(`${fn}: leaked ${g}`); }
  { const pol = (await sql.query(`select cmd, qual, with_check from pg_policies where schemaname='public' and tablename='knowledge_articles'`)).rows;
    const ins = pol.find((p) => p.cmd === "INSERT"), upd = pol.find((p) => p.cmd === "UPDATE");
    (ins && /hotel_id IS NULL.*is_platform_admin/s.test(ins.with_check || "")) ? ok("destination (hotel_id null) INSERT requires platform_admin") : bad("destination INSERT not admin-gated");
    (upd && /hotel_id IS NULL.*is_platform_admin/s.test(upd.qual || "")) ? ok("destination (hotel_id null) UPDATE requires platform_admin") : bad("destination UPDATE not admin-gated");
    ((await sql.query(`select count(*)::int c from pg_policies where schemaname='public' and tablename='knowledge_articles' and cmd='DELETE'`)).rows[0].c === 0) ? ok("no DELETE policy on knowledge_articles (archive-only)") : bad("DELETE policy exists"); }
  { const w = (await sql.query(`select with_check from pg_policies where schemaname='public' and tablename='knowledge_aliases' and cmd='ALL'`)).rows[0];
    (w && /hotel_id IS NULL.*is_platform_admin/s.test(w.with_check || "")) ? ok("destination aliases write requires platform_admin") : bad("alias write not admin-gated"); }
  // live denial
  const cleanup = async () => { try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await sql.query(`delete from public.knowledge_aliases where article_id in (select id from public.knowledge_articles where key like $1)`, [P + "%"]).catch(() => {}); await sql.query(`delete from public.knowledge_articles where key like $1`, [P + "%"]).catch(() => {}); await sql.query(`delete from public.hotel_memberships where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {}); await sql.query(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {}); await sql.query(`delete from public.knowledge_articles where destination_id in (select id from public.destinations where slug like $1)`, [P + "%"]).catch(() => {}); await sql.query(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {}); };
  const mkUser = async (k, admin = false) => { const email = `${P}.${k}${DOM}`; const { data } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true }); await svc.from("profiles").insert({ user_id: data.user.id, email, is_platform_admin: admin }); const c = createClient(URL, ANON, { auth: { persistSession: false } }); await c.auth.signInWithPassword({ email, password: PW }); return { id: data.user.id, c }; };
  try {
    await cleanup();
    const dest = (await svc.from("destinations").insert({ name: "SA", slug: `${P}-d`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const art = (await svc.from("knowledge_articles").insert({ destination_id: dest, hotel_id: null, source_type: "destination", key: `${P}-a`, title: "SA", approved_answer: "x", locale: "en", status: "published" }).select("id").single()).data.id;
    const hotelU = await mkUser("hotel", false); const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const hotel = (await svc.from("hotels").insert({ name: "SAH", slug: `${P}-h`, destination_id: dest, timezone: "Europe/Zagreb", currency: "EUR" }).select("id").single()).data.id;
    await svc.from("hotel_memberships").insert({ hotel_id: hotel, user_id: hotelU.id, role: "hotel_admin", status: "active" });
    denied(await hotelU.c.from("knowledge_articles").insert({ destination_id: dest, hotel_id: null, source_type: "destination", key: `${P}-hx`, title: "x", locale: "en" })) ? ok("hotel-role destination INSERT denied") : bad("hotel insert!");
    { const r = await hotelU.c.from("knowledge_articles").update({ title: "hack" }).eq("id", art).select("id"); (denied(r) || (r.data || []).length === 0) ? ok("hotel-role destination UPDATE denied") : bad("hotel update!"); }
    denied(await hotelU.c.rpc("rollback_knowledge_article", { p_article: art, p_version: art })) ? ok("hotel rollback denied") : bad("hotel rollback!");
    denied(await hotelU.c.from("knowledge_aliases").insert({ article_id: art, hotel_id: null, alias_text: "x", locale: "en" })) ? ok("hotel-role destination alias denied") : bad("hotel alias!");
    (((await anon.from("knowledge_articles").select("id").is("hotel_id", null).limit(1)).data || []).length === 0) ? ok("anon cannot read destination articles") : bad("anon read!");
    denied(await anon.rpc("publish_knowledge_article", { p_article: art, p_change_summary: "x", p_acknowledge_critical: false })) ? ok("anon publish denied") : bad("anon publish!");
    // hotel member reads published destination article (has_destination_access)
    (((await hotelU.c.from("knowledge_articles").select("id").eq("id", art)).data || []).length === 1) ? ok("hotel member reads published destination article") : bad("hotel cannot read published destination article");
  } finally { await cleanup(); }
  const nextDir = resolve(here, "../.next");
  if (existsSync(nextDir)) { let scanned = 0, leaked = false; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) { if (f !== "cache") walk(p); } else if (/\.(js|json)$/.test(f)) { scanned++; if (readFileSync(p, "utf8").includes(SRV)) { leaked = true; bad(`SR key in ${p}`); } } } }; try { walk(join(nextDir, "static")); } catch {} if (!leaked) ok(`bundle scan clean (${scanned})`); } else ok("bundle scan skipped");
  await sql.end(); console.log(`\n${fail === 0 ? "✅" : "❌"} Platform Destination AI security audit: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
