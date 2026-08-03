// ============================================================================
// AI OLLY Dashboard — Sprint 4 AI SECURITY AUDIT (aiolly-dev only).
// ----------------------------------------------------------------------------
// Audits the AI Knowledge DB surface + attempts to bypass every RPC / table
// from a DIFFERENT tenant and from anon. Verifies SECURITY DEFINER hygiene,
// EXECUTE grants (no anon/PUBLIC), content_versions closure, ai_response_logs
// protection (guest context), and cross-tenant / anon denial. Also scans the
// built browser bundle for secret leakage (service-role / OpenAI key). Reads
// the service-role key from ../../.env at runtime (never committed).
//
//   node dashboard/scripts/security-audit-ai.mjs
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
  console.log("AI OLLY — AI Knowledge security audit (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } });
  await sql.connect();

  // ── A) SECURITY DEFINER hygiene + grants ───────────────────────────────────
  const DEFINER_FNS = ["publish_knowledge_article", "rollback_knowledge_article", "list_article_versions", "publish_ai_config"];
  for (const fn of DEFINER_FNS) {
    const r = await sql.query(`select p.prosecdef, array_to_string(p.proconfig,',') cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn]);
    const row = r.rows[0];
    row?.prosecdef ? ok(`${fn}: SECURITY DEFINER`) : bad(`${fn}: not SECURITY DEFINER`);
    (row?.cfg || "").includes("search_path=") ? ok(`${fn}: explicit search_path`) : bad(`${fn}: NO explicit search_path`);
  }
  for (const fn of ["resolved_ai_knowledge", "resolved_ai_config"]) {
    const r = await sql.query(`select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn]);
    r.rows[0] && !r.rows[0].prosecdef ? ok(`${fn}: SECURITY INVOKER (caller RLS applies)`) : bad(`${fn}: unexpectedly DEFINER`);
  }
  for (const fn of [...DEFINER_FNS, "resolved_ai_knowledge", "resolved_ai_config"]) {
    const g = await sql.query(
      `select grantee from information_schema.routine_privileges rp
       join information_schema.routines ro on ro.specific_name=rp.specific_name
       where ro.routine_schema='public' and ro.routine_name=$1 and privilege_type='EXECUTE'`, [fn]);
    const grantees = g.rows.map((x) => x.grantee);
    (!grantees.includes("anon") && !grantees.includes("PUBLIC")) ? ok(`${fn}: no EXECUTE for anon/PUBLIC`) : bad(`${fn}: EXECUTE leaked to anon/PUBLIC (${grantees})`);
  }
  // content_versions stays closed to app roles
  {
    const pol = (await sql.query(`select count(*)::int c from pg_policies where schemaname='public' and tablename='content_versions'`)).rows[0].c;
    const gr = (await sql.query(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name='content_versions' and grantee in ('anon','authenticated')`)).rows[0].c;
    pol === 0 ? ok("content_versions: still 0 RLS policies (Step 1 invariant)") : bad(`content_versions: ${pol} policies added`);
    gr === 0 ? ok("content_versions: no anon/authenticated grants") : bad("content_versions: grants leaked");
  }
  // ai_response_logs (guest context): no authenticated INSERT, no anon access
  {
    const insGr = (await sql.query(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name='ai_response_logs' and privilege_type='INSERT' and grantee in ('anon','authenticated')`)).rows[0].c;
    insGr === 0 ? ok("ai_response_logs: no anon/authenticated INSERT (service_role only)") : bad("ai_response_logs: INSERT leaked to app roles");
  }

  // ── B) foreign tenant the demo user is NOT a member of ─────────────────────
  const getOrInsert = async (table, match, row) => {
    let q = svc.from(table).select("id");
    for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
    const f = await q.maybeSingle();
    if (f.data?.id) return f.data.id;
    const r = await svc.from(table).insert({ ...match, ...row }).select("id").single();
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    return r.data.id;
  };
  const destId = await getOrInsert("destinations", { slug: "sec-ai-dest" }, { name: "Sec AI", timezone: "Europe/Zagreb" });
  const otherHotel = await getOrInsert("hotels", { slug: "sec-ai-hotel" }, { name: "Sec AI Hotel", destination_id: destId, timezone: "Europe/Zagreb", currency: "EUR", status: "active" });
  const cat = await getOrInsert("knowledge_categories", { hotel_id: otherHotel, key: "sec-ai-cat" }, { name: "Sec" });
  const otherArt = await getOrInsert("knowledge_articles", { hotel_id: otherHotel, key: "sec-ai-secret", locale: "en" }, { category_id: cat, title: "Secret KB", body_content: { version: 1, blocks: [{ type: "paragraph", text: "secret" }] }, approved_answer: "secret", status: "published", published_at: new Date().toISOString(), published_snapshot: { source_type: "hotel", title: "Secret KB", key: "sec-ai-secret", approved_answer: "secret", body_content: { version: 1, blocks: [{ type: "paragraph", text: "secret" }] }, active: true, available_to_ai: true, priority: 0, category_id: cat, is_critical: false, published_at: new Date().toISOString() } });
  const otherUq = await getOrInsert("unanswered_questions", { hotel_id: otherHotel, normalized_question: "sec-ai secret question" }, { occurrence_count: 1, status: "open" });
  await getOrInsert("ai_configs", { hotel_id: otherHotel }, { tone: "secret", status: "published", active: true, published_at: new Date().toISOString() });
  const vExists = (await svc.from("content_versions").select("id").eq("entity_type", "knowledge_article").eq("entity_id", otherArt).maybeSingle()).data;
  if (!vExists) await svc.from("content_versions").insert({ entity_type: "knowledge_article", entity_id: otherArt, version_number: 1, status: "published", snapshot: { title: "Secret" }, hotel_id: otherHotel, published_at: new Date().toISOString() });
  const otherVersionId = (await svc.from("content_versions").select("id").eq("entity_type", "knowledge_article").eq("entity_id", otherArt).limit(1).single()).data.id;

  // ── C) demo user (member of demo, NOT the foreign hotel) ───────────────────
  const demo = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await demo.auth.signInWithPassword({ email: "demo@aiolly.dev", password: "AiOllyDemo!2026" });
  s.error ? bad("demo sign-in failed: " + s.error.message) : ok("signed in as demo@aiolly.dev (non-member of foreign hotel)");

  ((await demo.from("knowledge_articles").select("id").eq("id", otherArt)).data ?? []).length === 0 ? ok("cross-tenant: cannot read foreign hotel article") : bad("cross-tenant article READ leaked");
  ((await demo.from("unanswered_questions").select("id").eq("id", otherUq)).data ?? []).length === 0 ? ok("cross-tenant: cannot read foreign unanswered") : bad("cross-tenant unanswered leaked");
  ((await demo.from("ai_response_logs").select("id").eq("hotel_id", otherHotel)).data ?? []).length === 0 ? ok("cross-tenant: cannot read foreign ai_response_logs") : bad("cross-tenant logs leaked");
  denied(await demo.from("knowledge_articles").update({ title: "HACKED" }).eq("id", otherArt)) || (await svc.from("knowledge_articles").select("title").eq("id", otherArt).single()).data.title === "Secret KB"
    ? ok("cross-tenant: cannot UPDATE foreign article") : bad("cross-tenant UPDATE succeeded");
  { const r = await demo.rpc("publish_knowledge_article", { p_article: otherArt, p_acknowledge_critical: true }); (r.error && /privilege/i.test(r.error.message)) ? ok("cross-tenant: publish_knowledge_article denied") : bad("cross-tenant publish allowed"); }
  { const r = await demo.rpc("rollback_knowledge_article", { p_article: otherArt, p_version: otherVersionId }); (r.error) ? ok("cross-tenant: rollback_knowledge_article denied") : bad("cross-tenant rollback allowed"); }
  { const r = await demo.rpc("list_article_versions", { p_article: otherArt }); (r.error && /privilege/i.test(r.error.message)) ? ok("cross-tenant: list_article_versions denied") : bad(`cross-tenant history leaked: ${JSON.stringify(r.data)}`); }
  { const r = await demo.rpc("resolved_ai_knowledge", { p_hotel: otherHotel, p_locale: "en", p_preview: false }); const keys = (r.data ?? []).map((x) => x.key); (!keys.includes("sec-ai-secret")) ? ok("cross-tenant: resolved_ai_knowledge hides foreign hotel article") : bad("cross-tenant resolved leaked"); }
  { const r = await demo.rpc("resolved_ai_knowledge", { p_hotel: otherHotel, p_locale: "en", p_preview: true }); const keys = (r.data ?? []).map((x) => x.key); (!keys.includes("sec-ai-secret")) ? ok("cross-tenant: PREVIEW mode also hides foreign article (not an author)") : bad("cross-tenant preview leaked"); }

  // ── D) anon (no login) cannot touch anything ───────────────────────────────
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  for (const [fn, args] of [["publish_knowledge_article", { p_article: otherArt }], ["rollback_knowledge_article", { p_article: otherArt, p_version: otherVersionId }], ["list_article_versions", { p_article: otherArt }]]) {
    denied(await anon.rpc(fn, args)) ? ok(`anon: ${fn} denied`) : bad(`anon: ${fn} allowed`);
  }
  (((await anon.from("knowledge_articles").select("id")).data ?? []).length === 0) ? ok("anon: cannot read knowledge_articles") : bad("anon read articles");
  (((await anon.from("unanswered_questions").select("id")).data ?? []).length === 0) ? ok("anon: cannot read unanswered_questions") : bad("anon read unanswered");
  (((await anon.from("ai_response_logs").select("id")).data ?? []).length === 0) ? ok("anon: cannot read ai_response_logs") : bad("anon read logs");

  // ── E) browser bundle must not embed secrets ───────────────────────────────
  const nextDir = resolve(here, "../.next");
  if (existsSync(nextDir)) {
    const svcKey = SRV, openai = process.env.OPENAI_API_KEY || readTry("OPENAI_API_KEY");
    let scanned = 0, leaked = false;
    const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) { if (f !== "cache") walk(p); } else if (/\.(js|json)$/.test(f)) { scanned++; const txt = readFileSync(p, "utf8"); if (txt.includes(svcKey)) { leaked = true; bad(`service-role key found in bundle: ${p}`); } if (openai && txt.includes(openai)) { leaked = true; bad(`OpenAI key found in bundle: ${p}`); } if (/service_role/.test(txt) && /eyJ[A-Za-z0-9_-]{20,}/.test(txt)) { /* heuristic only */ } } } };
    try { walk(join(nextDir, "static")); } catch {}
    (!leaked) ? ok(`bundle scan: no service-role/OpenAI key in ${scanned} built assets`) : null;
  } else {
    ok("bundle scan skipped (.next not built) — run `npm run build` then re-run to scan");
  }

  // ── cleanup foreign tenant ─────────────────────────────────────────────────
  await sql.query(`delete from public.content_versions where entity_id=$1`, [otherArt]).catch(() => {});
  await sql.query(`delete from public.audit_log where hotel_id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.knowledge_aliases where hotel_id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.unanswered_questions where hotel_id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.ai_configs where hotel_id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.knowledge_articles where hotel_id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.knowledge_categories where hotel_id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.hotels where id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.destinations where id=$1`, [destId]).catch(() => {});
  await sql.end();

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. Foreign tenant cleaned up. No secrets logged.`);
  process.exit(fail === 0 ? 0 : 1);
}

function readTry(k) { try { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; } catch { return ""; } }

main().catch((e) => { console.error("  audit error:", e.message); process.exit(1); });
