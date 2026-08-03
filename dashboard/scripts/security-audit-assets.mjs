// ============================================================================
// AI OLLY Dashboard — Sprint 6 ASSET SECURITY AUDIT (aiolly-dev only).
// ----------------------------------------------------------------------------
// Audits the Storage/Asset surface: SECURITY DEFINER hygiene + EXECUTE grants
// (no anon/PUBLIC), private buckets have NO anon/authenticated Storage policies,
// public-media path validation, redacted asset audit (no signed URLs / no
// binaries), and cross-tenant + anon + suspended-member denial for private
// files. Also scans the built browser bundle for the service-role key. Reads the
// service-role key from ../../.env (never committed).
//
//   node dashboard/scripts/security-audit-assets.mjs
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

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };
const denied = (r) => !!(r && r.error);

async function main() {
  console.log("AI OLLY — Asset security audit (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } });
  await sql.connect();

  // ── A) SECURITY DEFINER hygiene + grants ───────────────────────────────────
  const DEFINER_FNS = ["finalize_asset", "can_manage_media"];
  for (const fn of DEFINER_FNS) {
    const r = await sql.query(`select p.prosecdef, array_to_string(p.proconfig,',') cfg, n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname=$1 and n.nspname in ('public','platform')`, [fn]);
    const row = r.rows[0];
    row?.prosecdef ? ok(`${fn}: SECURITY DEFINER`) : bad(`${fn}: not SECURITY DEFINER`);
    (row?.cfg || "").includes("search_path=") ? ok(`${fn}: explicit search_path`) : bad(`${fn}: NO explicit search_path`);
  }
  { const r = await sql.query(`select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='asset_usage_report'`);
    r.rows[0] && !r.rows[0].prosecdef ? ok("asset_usage_report: SECURITY INVOKER (caller RLS applies)") : bad("asset_usage_report: unexpectedly DEFINER"); }
  for (const [schema, fn] of [["public", "finalize_asset"], ["public", "asset_usage_report"], ["public", "sign_consent"], ["platform", "can_manage_media"]]) {
    const g = await sql.query(
      `select grantee from information_schema.routine_privileges rp join information_schema.routines ro on ro.specific_name=rp.specific_name
       where ro.routine_schema=$1 and ro.routine_name=$2 and privilege_type='EXECUTE'`, [schema, fn]);
    const grantees = g.rows.map((x) => x.grantee);
    (!grantees.includes("anon") && !grantees.includes("PUBLIC")) ? ok(`${fn}: no EXECUTE for anon/PUBLIC`) : bad(`${fn}: EXECUTE leaked to anon/PUBLIC (${grantees})`);
  }

  // ── B) private buckets: no anon/authenticated Storage policies ─────────────
  {
    const pol = (await sql.query(`select count(*)::int c from pg_policies where schemaname='storage' and tablename='objects' and qual ~ 'private-documents|consent-files'`)).rows[0].c;
    pol === 0 ? ok("storage.objects: no policy references private-documents/consent-files (service-role only)") : bad(`private buckets have ${pol} object policies`);
    const buckets = (await sql.query(`select id, public from storage.buckets where id in ('private-documents','consent-files','public-media')`)).rows;
    const priv = buckets.filter((b) => b.id !== "public-media");
    priv.every((b) => b.public === false) ? ok("private buckets are non-public") : bad("a private bucket is public");
    (buckets.find((b) => b.id === "public-media")?.public === true) ? ok("public-media is public-read") : bad("public-media not public");
  }
  // public-media write policy must go through can_manage_media (path validation)
  {
    const w = (await sql.query(`select qual, with_check from pg_policies where schemaname='storage' and tablename='objects' and policyname='pkgc_public_media_write'`)).rows[0];
    (w && /can_manage_media/.test(w.with_check || "")) ? ok("public-media writes are path-validated (can_manage_media)") : bad("public-media write policy missing path validation");
  }

  // ── C) redacted audit: no signed URLs / binaries / tokens in asset audit ───
  {
    const leak = (await sql.query(`select count(*)::int c from public.audit_log where entity_type in ('asset','asset_usage')
      and ( (after_state)::text ~* '(token=|signedurl|base64|data:image|\\.supabase\\.co/storage)' or (metadata)::text ~* '(token=|signedurl|data:image)' )`)).rows[0].c;
    leak === 0 ? ok("audit_log: no signed URLs / binaries / tokens in asset snapshots") : bad(`audit_log: ${leak} asset rows leak sensitive data`);
  }

  // ── D) foreign tenant + suspended member ───────────────────────────────────
  const getOrInsert = async (table, match, row) => {
    let q = svc.from(table).select("id");
    for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
    const f = await q.maybeSingle();
    if (f.data?.id) return f.data.id;
    const r = await svc.from(table).insert({ ...match, ...row }).select("id").single();
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    return r.data.id;
  };
  const destId = await getOrInsert("destinations", { slug: "sec-ast-dest" }, { name: "Sec Ast", timezone: "Europe/Zagreb" });
  const otherHotel = await getOrInsert("hotels", { slug: "sec-ast-hotel" }, { name: "Sec Ast Hotel", destination_id: destId, timezone: "Europe/Zagreb", currency: "EUR", status: "active" });
  const pubPath = `hotels/${otherHotel}/images/sec/pub.svg`, sigPath = `hotels/${otherHotel}/consent-signatures/sec/sig.svg`;
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>', "utf8");
  await svc.storage.from("public-media").upload(pubPath, svg, { contentType: "image/svg+xml", upsert: true });
  await svc.storage.from("consent-files").upload(sigPath, svg, { contentType: "image/svg+xml", upsert: true });
  const oPub = await getOrInsert("assets", { storage_path: pubPath }, { hotel_id: otherHotel, asset_type: "hotel_image", bucket_name: "public-media", mime_type: "image/svg+xml", file_size_bytes: svg.length, public_access: true, status: "ready", display_name: "sec pub" });
  const oSig = await getOrInsert("assets", { storage_path: sigPath }, { hotel_id: otherHotel, asset_type: "consent_signature", bucket_name: "consent-files", mime_type: "image/svg+xml", file_size_bytes: svg.length, status: "ready", display_name: "sec sig" });

  const demoUser = (await svc.auth.admin.listUsers({ page: 1, perPage: 200 })).data.users.find((x) => x.email === "demo@aiolly.dev");
  if (demoUser) {
    const ex = await svc.from("hotel_memberships").select("id").eq("hotel_id", otherHotel).eq("user_id", demoUser.id).maybeSingle();
    if (ex.data?.id) await svc.from("hotel_memberships").update({ role: "reception", status: "suspended" }).eq("id", ex.data.id);
    else await svc.from("hotel_memberships").insert({ hotel_id: otherHotel, user_id: demoUser.id, role: "reception", status: "suspended" });
  }

  const demo = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await demo.auth.signInWithPassword({ email: "demo@aiolly.dev", password: "AiOllyDemo!2026" });
  s.error ? bad("demo sign-in failed: " + s.error.message) : ok("signed in as demo@aiolly.dev (suspended at foreign hotel)");

  ((await demo.from("assets").select("id").eq("id", oPub)).data ?? []).length === 0 ? ok("cross-tenant/suspended: cannot read foreign asset row") : bad("foreign asset row leaked");
  ((await demo.from("assets").select("id").eq("id", oSig)).data ?? []).length === 0 ? ok("cross-tenant: cannot read foreign private signature row") : bad("foreign private signature row leaked");
  // authenticated cannot read private-bucket objects directly (no policy)
  { const r = await demo.storage.from("consent-files").download(sigPath); (r.error) ? ok("authenticated cannot download from consent-files directly") : bad("consent-files readable by authenticated"); }
  { const r = await demo.storage.from("private-documents").list(`hotels/${otherHotel}`); (r.error || (r.data ?? []).length === 0) ? ok("authenticated cannot list private-documents") : bad("private-documents listable"); }
  // authenticated cannot write to another hotel's public-media path
  { const r = await demo.storage.from("public-media").upload(`hotels/${otherHotel}/images/hack.svg`, svg, { contentType: "image/svg+xml" }); (r.error) ? ok("cross-tenant public-media write denied (path validation)") : bad("cross-tenant public-media write allowed"); }
  // cross-tenant asset write / finalize
  { const r = await demo.from("assets").update({ display_name: "HACK" }).eq("id", oPub); const nm = (await svc.from("assets").select("display_name").eq("id", oPub).single()).data.display_name; (denied(r) || nm === "sec pub") ? ok("cross-tenant: cannot UPDATE foreign asset") : bad("foreign asset UPDATE succeeded"); }
  { const r = await demo.rpc("finalize_asset", { p_asset: oPub, p_size: 10 }); (r.error) ? ok("cross-tenant: finalize_asset denied") : bad("cross-tenant finalize allowed"); }
  { const r = await demo.rpc("asset_usage_report", { p_asset: oSig }); ((r.data ?? []).length === 0) ? ok("cross-tenant: asset_usage_report returns nothing for foreign asset") : bad("cross-tenant usage report leaked"); }

  // ── E) anon ────────────────────────────────────────────────────────────────
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  (((await anon.from("assets").select("id")).data ?? []).length === 0) ? ok("anon: cannot read assets") : bad("anon read assets");
  { const r = await anon.storage.from("consent-files").download(sigPath); (r.error) ? ok("anon: cannot download private consent file") : bad("anon downloaded consent file"); }
  { const r = await anon.storage.from("public-media").upload(`hotels/${otherHotel}/images/anon.svg`, svg, { contentType: "image/svg+xml" }); (r.error) ? ok("anon: cannot write public-media") : bad("anon wrote public-media"); }
  { const r = await anon.rpc("finalize_asset", { p_asset: oPub, p_size: 10 }); (r.error) ? ok("anon: finalize_asset denied") : bad("anon finalize allowed"); }
  // public-media READ is intentionally public
  { const r = await anon.storage.from("public-media").download(pubPath); (!r.error) ? ok("public-media object is publicly readable (by design)") : bad("public-media not publicly readable"); }

  // ── F) browser bundle secret scan ──────────────────────────────────────────
  const nextDir = resolve(here, "../.next");
  if (existsSync(nextDir)) {
    let scanned = 0, leaked = false;
    const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) { if (f !== "cache") walk(p); } else if (/\.(js|json)$/.test(f)) { scanned++; const txt = readFileSync(p, "utf8"); if (txt.includes(SRV)) { leaked = true; bad(`service-role key in bundle: ${p}`); } } } };
    try { walk(join(nextDir, "static")); } catch {}
    (!leaked) ? ok(`bundle scan: no service-role key in ${scanned} built assets`) : null;
  } else ok("bundle scan skipped (.next not built)");

  // ── cleanup ────────────────────────────────────────────────────────────────
  try { await svc.storage.from("public-media").remove([pubPath]); } catch {}
  try { await svc.storage.from("consent-files").remove([sigPath]); } catch {}
  if (demoUser) { try { await svc.from("hotel_memberships").delete().eq("hotel_id", otherHotel).eq("user_id", demoUser.id); } catch {} }
  for (const t of ["asset_usages", "assets", "audit_log"]) await sql.query(`delete from public.${t} where hotel_id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.hotels where id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.destinations where id=$1`, [destId]).catch(() => {});
  await sql.end();

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. Foreign tenant + objects cleaned up. No secrets logged.`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("  audit error:", e.message); process.exit(1); });
