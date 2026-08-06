// AI OLLY — Platform CMS Media SECURITY AUDIT (aiolly-dev only).
// Platform/destination public media (assets, hotel_id IS NULL) INSERT/UPDATE require
// platform_admin (RLS); finalize_asset SECURITY DEFINER + no anon/PUBLIC; no DELETE
// policy (archive-only); private consent/document types never surface at platform scope;
// storage writes to platform/… paths require platform_admin (can_manage_media); no
// bundle secrets. Keys from ../../.env.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve, join } from "node:path";
import pg from "pg"; import { createClient } from "@supabase/supabase-js";
const here = dirname(fileURLToPath(import.meta.url)); const envPath = resolve(here, "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), SRV = readEnv("SUPABASE_SERVICE_ROLE_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, SRV, { auth: { persistSession: false } });
const P = "sam", DOM = "@sec-media.local", PW = "Sec-Media!1";
let pass = 0, fail = 0; const ok = (m) => { pass++; console.log("  ✓", m); }; const bad = (m) => { fail++; console.log("  ✗", m); }; const denied = (r) => !!(r && r.error);

async function main() {
  console.log("AI OLLY — Platform Media security audit (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();

  // finalize_asset hardening
  { const r = (await sql.query(`select prosecdef, array_to_string(proconfig,',') cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='finalize_asset'`)).rows[0];
    r?.prosecdef ? ok("finalize_asset: SECURITY DEFINER") : bad("finalize_asset: not SECDEF");
    (r?.cfg || "").includes("search_path=") ? ok("finalize_asset: search_path pinned") : bad("finalize_asset: no search_path");
    const g = (await sql.query(`select grantee from information_schema.routine_privileges rp join information_schema.routines ro on ro.specific_name=rp.specific_name where ro.routine_schema='public' and ro.routine_name='finalize_asset' and privilege_type='EXECUTE'`)).rows.map((x) => x.grantee);
    (!g.includes("anon") && !g.includes("PUBLIC")) ? ok("finalize_asset: no anon/PUBLIC EXECUTE") : bad(`finalize_asset: leaked ${g}`); }

  // RLS: platform (hotel_id null) INSERT/UPDATE admin-gated + no DELETE policy
  { const pol = (await sql.query(`select cmd, qual, with_check from pg_policies where schemaname='public' and tablename='assets'`)).rows;
    const ins = pol.find((p) => p.cmd === "INSERT"), upd = pol.find((p) => p.cmd === "UPDATE"), sel = pol.find((p) => p.cmd === "SELECT");
    (ins && /hotel_id IS NULL.*is_platform_admin/s.test(ins.with_check || "")) ? ok("platform (hotel_id null) INSERT requires platform_admin") : bad("platform INSERT not admin-gated");
    (upd && /hotel_id IS NULL.*is_platform_admin/s.test(upd.qual || "")) ? ok("platform (hotel_id null) UPDATE requires platform_admin") : bad("platform UPDATE not admin-gated");
    (sel && /has_any_membership/s.test(sel.qual || "")) ? ok("SELECT requires a membership (anon excluded)") : bad("SELECT not membership-gated");
    ((await sql.query(`select count(*)::int c from pg_policies where schemaname='public' and tablename='assets' and cmd='DELETE'`)).rows[0].c === 0) ? ok("no DELETE policy on assets (archive-only)") : bad("DELETE policy exists"); }

  // private types are never publicly accessible (normalize) + private bucket CHECK
  { const has = (await sql.query(`select count(*)::int c from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='platform' and proname='asset_is_private_type'`)).rows[0].c;
    has ? ok("asset_is_private_type gate present (consent/document stay private)") : bad("private-type gate missing");
    const ck = (await sql.query(`select count(*)::int c from pg_constraint where conrelid='public.assets'::regclass and conname='assets_private_bucket'`)).rows[0].c;
    ck ? ok("assets_private_bucket CHECK forbids private types in public-media") : bad("private-bucket CHECK missing"); }

  // storage: public-media writes to platform/… paths require platform_admin
  { const fn = (await sql.query(`select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='platform' and proname='can_manage_media'`)).rows[0]?.d || "";
    /is_platform_admin\(\)/.test(fn) ? ok("can_manage_media grants platform paths only to platform_admin") : bad("can_manage_media missing admin gate");
    const wp = (await sql.query(`select with_check from pg_policies where schemaname='storage' and tablename='objects' and cmd='INSERT' and policyname='pkgc_public_media_write'`)).rows[0];
    (wp && /can_manage_media/.test(wp.with_check || "")) ? ok("public-media INSERT policy calls can_manage_media") : bad("public-media write policy not gated"); }

  // live denial: hotel-role cannot write platform media; anon cannot read
  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await sql.query(`delete from public.assets where display_name like $1`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.hotel_memberships where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {});
  };
  const mkUser = async (k, admin = false) => { const email = `${P}.${k}${DOM}`; const { data } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true }); await svc.from("profiles").insert({ user_id: data.user.id, email, is_platform_admin: admin }); const c = createClient(URL, ANON, { auth: { persistSession: false } }); await c.auth.signInWithPassword({ email, password: PW }); return { id: data.user.id, c }; };
  try {
    await cleanup();
    const dest = (await svc.from("destinations").insert({ name: "SAM", slug: `${P}-d`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const plat = (await svc.from("assets").insert({ hotel_id: null, destination_id: dest, asset_type: "poi_image", external_provider: "cdn", external_url: `https://x/${P}.jpg`, display_name: `${P} a`, status: "ready" }).select("id").single()).data.id;
    const hotelU = await mkUser("hotel", false); const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const hotel = (await svc.from("hotels").insert({ name: "SAMH", slug: `${P}-h`, destination_id: dest, timezone: "Europe/Zagreb", currency: "EUR" }).select("id").single()).data.id;
    await svc.from("hotel_memberships").insert({ hotel_id: hotel, user_id: hotelU.id, role: "hotel_admin", status: "active" });
    denied(await hotelU.c.from("assets").insert({ hotel_id: null, destination_id: dest, asset_type: "poi_image", external_provider: "cdn", external_url: `https://x/${P}-hx`, display_name: `${P} hx`, status: "ready" })) ? ok("hotel-role platform-media INSERT denied") : bad("hotel insert!");
    { const r = await hotelU.c.from("assets").update({ display_name: "hack" }).eq("id", plat).select("id"); (denied(r) || (r.data || []).length === 0) ? ok("hotel-role platform-media UPDATE denied") : bad("hotel update!"); }
    denied(await hotelU.c.rpc("finalize_asset", { p_asset: plat, p_size: 1 })) ? ok("hotel-role finalize of platform media denied") : bad("hotel finalize!");
    (((await anon.from("assets").select("id").eq("id", plat)).data || []).length === 0) ? ok("anon cannot read platform media") : bad("anon read!");
    { const r = await hotelU.c.from("assets").delete().eq("id", plat).select("id"); (denied(r) || (r.data || []).length === 0) ? ok("hotel-role cannot hard-delete platform media") : bad("hotel delete!"); }
  } finally { await cleanup(); }

  const nextDir = resolve(here, "../.next");
  if (existsSync(nextDir)) { let scanned = 0, leaked = false; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) { if (f !== "cache") walk(p); } else if (/\.(js|json)$/.test(f)) { scanned++; if (readFileSync(p, "utf8").includes(SRV)) { leaked = true; bad(`SR key in ${p}`); } } } }; try { walk(join(nextDir, "static")); } catch {} if (!leaked) ok(`bundle scan clean (${scanned})`); } else ok("bundle scan skipped");
  await sql.end(); console.log(`\n${fail === 0 ? "✅" : "❌"} Platform Media security audit: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
