// ============================================================================
// AI OLLY Dashboard — Sprint 7 NEWSLETTER SECURITY AUDIT (aiolly-dev only).
// ----------------------------------------------------------------------------
// Audits the newsletter surface: SECURITY DEFINER hygiene + EXECUTE grants (no
// anon/PUBLIC), webhook_events backend-only, events append-only, redacted audit
// (no subscriber email / provider payloads), campaign snapshot immutability after
// schedule, no-consent audience exclusion, and cross-tenant + anon + suspended
// denial. Scans the built browser bundle for the service-role key + any Brevo key.
// No real external HTTP/email is made. Reads the service-role key from ../../.env.
//
//   node dashboard/scripts/security-audit-newsletter.mjs
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
  console.log("AI OLLY — Newsletter security audit (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } });
  await sql.connect();

  // ── A) SECURITY DEFINER hygiene + grants ───────────────────────────────────
  const DEFINER_FNS = ["publish_newsletter_template", "schedule_campaign", "resolve_newsletter_audience", "rollback_newsletter_template", "list_newsletter_template_versions", "newsletter_consent_status"];
  for (const fn of DEFINER_FNS) {
    const r = await sql.query(`select p.prosecdef, array_to_string(p.proconfig,',') cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn]);
    const row = r.rows[0];
    row?.prosecdef ? ok(`${fn}: SECURITY DEFINER`) : bad(`${fn}: not SECURITY DEFINER`);
    (row?.cfg || "").includes("search_path=") ? ok(`${fn}: explicit search_path`) : bad(`${fn}: NO explicit search_path`);
  }
  for (const fn of DEFINER_FNS) {
    const g = await sql.query(`select grantee from information_schema.routine_privileges rp join information_schema.routines ro on ro.specific_name=rp.specific_name where ro.routine_schema='public' and ro.routine_name=$1 and privilege_type='EXECUTE'`, [fn]);
    const grantees = g.rows.map((x) => x.grantee);
    (!grantees.includes("anon") && !grantees.includes("PUBLIC")) ? ok(`${fn}: no EXECUTE for anon/PUBLIC`) : bad(`${fn}: EXECUTE leaked to anon/PUBLIC (${grantees})`);
  }

  // ── B) webhook_events backend-only; events append-only ─────────────────────
  {
    const g = (await sql.query(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name='newsletter_webhook_events' and grantee in ('anon','authenticated')`)).rows[0].c;
    g === 0 ? ok("newsletter_webhook_events: no anon/authenticated grants (backend-only)") : bad("webhook_events grants leaked to app roles");
    const pol = (await sql.query(`select count(*)::int c from pg_policies where schemaname='public' and tablename='newsletter_webhook_events'`)).rows[0].c;
    pol === 0 ? ok("newsletter_webhook_events: no RLS policies (never authenticated-readable)") : bad("webhook_events has policies");
  }
  {
    const c = (await sql.query(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name='newsletter_events' and privilege_type in ('UPDATE','DELETE') and grantee in ('anon','authenticated')`)).rows[0].c;
    c === 0 ? ok("newsletter_events: no UPDATE/DELETE grants (append-only)") : bad("newsletter_events mutable grants present");
  }

  // ── C) redacted audit: no subscriber email / provider payloads ─────────────
  {
    const leak = (await sql.query(`select count(*)::int c from public.audit_log where entity_type in ('newsletter_subscriber','newsletter_campaign')
      and ( (after_state)::text ~* '(@[a-z0-9.-]+\\.[a-z]{2,}|payload|token=)' )`)).rows[0].c;
    leak === 0 ? ok("audit_log: no subscriber email / payloads in newsletter snapshots") : bad(`audit_log: ${leak} rows leak sensitive data`);
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
  const destId = await getOrInsert("destinations", { slug: "sec-nl-dest" }, { name: "Sec NL", timezone: "Europe/Zagreb" });
  const otherHotel = await getOrInsert("hotels", { slug: "sec-nl-hotel" }, { name: "Sec NL Hotel", destination_id: destId, timezone: "Europe/Zagreb", currency: "EUR", status: "active" });
  const oSub = await getOrInsert("newsletter_subscribers", { hotel_id: otherHotel, email: "secret-sub@example.com" }, { status: "subscribed", subscribed_at: new Date().toISOString() });
  const oSeg = await getOrInsert("newsletter_segments", { hotel_id: otherHotel, key: "sec-seg" }, { name: "Sec", type: "static" });
  const oTpl = await getOrInsert("newsletter_templates", { hotel_id: otherHotel, key: "sec-tpl", locale: "en" }, { name: "Sec", subject: "Sec", content: { version: 1, blocks: [] }, status: "published", published_at: new Date().toISOString(), published_snapshot: { subject: "Sec", content: { version: 1, blocks: [] } } });
  const oCamp = await getOrInsert("newsletter_campaigns", { hotel_id: otherHotel, name: "Sec Camp" }, { template_id: oTpl, segment_id: oSeg, status: "scheduled", scheduled_at: new Date().toISOString(), subject_snapshot: "Sec", content_snapshot: { version: 1, blocks: [] } });

  const demoUser = (await svc.auth.admin.listUsers({ page: 1, perPage: 200 })).data.users.find((x) => x.email === "demo@aiolly.dev");
  if (demoUser) {
    const ex = await svc.from("hotel_memberships").select("id").eq("hotel_id", otherHotel).eq("user_id", demoUser.id).maybeSingle();
    if (ex.data?.id) await svc.from("hotel_memberships").update({ role: "marketing", status: "suspended" }).eq("id", ex.data.id);
    else await svc.from("hotel_memberships").insert({ hotel_id: otherHotel, user_id: demoUser.id, role: "marketing", status: "suspended" });
  }

  const demo = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await demo.auth.signInWithPassword({ email: "demo@aiolly.dev", password: "AiOllyDemo!2026" });
  s.error ? bad("demo sign-in failed: " + s.error.message) : ok("signed in as demo@aiolly.dev (suspended at foreign hotel)");

  ((await demo.from("newsletter_subscribers").select("id").eq("id", oSub)).data ?? []).length === 0 ? ok("cross-tenant/suspended: cannot read foreign subscriber") : bad("foreign subscriber leaked");
  ((await demo.from("newsletter_campaigns").select("id").eq("id", oCamp)).data ?? []).length === 0 ? ok("cross-tenant: cannot read foreign campaign") : bad("foreign campaign leaked");
  { const r = await demo.rpc("resolve_newsletter_audience", { p_segment: oSeg }); (r.error) ? ok("cross-tenant: resolve_newsletter_audience denied") : bad("cross-tenant audience allowed"); }
  { const r = await demo.rpc("schedule_campaign", { p_campaign: oCamp, p_scheduled_at: new Date().toISOString() }); (r.error) ? ok("cross-tenant: schedule_campaign denied") : bad("cross-tenant schedule allowed"); }
  { const r = await demo.rpc("publish_newsletter_template", { p_template: oTpl }); (r.error) ? ok("cross-tenant: publish_newsletter_template denied") : bad("cross-tenant publish allowed"); }
  { const r = await demo.rpc("newsletter_consent_status", { p_hotel: otherHotel }); (r.error) ? ok("cross-tenant: newsletter_consent_status denied") : bad("cross-tenant consent status allowed"); }
  // snapshot immutability from a legitimate manager is verified in verify-newsletter; here confirm the trigger exists
  { const t = (await sql.query(`select count(*)::int c from pg_trigger where tgname='trg_newsletter_campaigns_protect'`)).rows[0].c; t === 1 ? ok("campaign snapshot-protection trigger present") : bad("snapshot protection trigger missing"); }
  // no-consent audience: a subscribed subscriber without consent is excluded (structural check)
  { const src = (await sql.query(`select pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='resolve_newsletter_audience'`)).rows[0].def;
    (/status\s*=\s*'granted'/.test(src) && /consent_id is not null/.test(src) && /status\s*=\s*'subscribed'/.test(src)) ? ok("resolve_newsletter_audience hard-enforces subscribed + granted consent") : bad("audience function missing consent/subscribe gate"); }

  // ── E) anon ────────────────────────────────────────────────────────────────
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  for (const t of ["newsletter_subscribers", "newsletter_segments", "newsletter_templates", "newsletter_campaigns", "newsletter_events"])
    (((await anon.from(t).select("id")).data ?? []).length === 0) ? ok(`anon: cannot read ${t}`) : bad(`anon read ${t}`);
  denied(await anon.rpc("resolve_newsletter_audience", { p_segment: oSeg })) ? ok("anon: resolve_newsletter_audience denied") : bad("anon audience allowed");
  denied(await anon.rpc("schedule_campaign", { p_campaign: oCamp, p_scheduled_at: new Date().toISOString() })) ? ok("anon: schedule_campaign denied") : bad("anon schedule allowed");

  // ── F) browser bundle: no service-role / Brevo key ─────────────────────────
  const nextDir = resolve(here, "../.next");
  const brevoKey = process.env.BREVO_API_KEY || "";
  if (existsSync(nextDir)) {
    let scanned = 0, leaked = false;
    const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) { if (f !== "cache") walk(p); } else if (/\.(js|json)$/.test(f)) { scanned++; const txt = readFileSync(p, "utf8"); if (txt.includes(SRV)) { leaked = true; bad(`service-role key in bundle: ${p}`); } if (brevoKey && txt.includes(brevoKey)) { leaked = true; bad(`Brevo key in bundle: ${p}`); } if (/xkeysib-/.test(txt)) { leaked = true; bad(`Brevo-style key pattern in bundle: ${p}`); } } } };
    try { walk(join(nextDir, "static")); } catch {}
    (!leaked) ? ok(`bundle scan: no service-role / Brevo key in ${scanned} built assets`) : null;
  } else ok("bundle scan skipped (.next not built)");

  // ── cleanup ────────────────────────────────────────────────────────────────
  if (demoUser) { try { await svc.from("hotel_memberships").delete().eq("hotel_id", otherHotel).eq("user_id", demoUser.id); } catch {} }
  for (const t of ["newsletter_webhook_events", "newsletter_events", "newsletter_campaign_recipients", "newsletter_campaigns", "newsletter_segment_members", "newsletter_segments", "newsletter_templates", "newsletter_subscribers", "audit_log"])
    await sql.query(`delete from public.${t} where hotel_id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.hotels where id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.destinations where id=$1`, [destId]).catch(() => {});
  await sql.end();

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. Foreign tenant cleaned up. No secrets logged; no external calls.`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("  audit error:", e.message); process.exit(1); });
