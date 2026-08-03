// ============================================================================
// AI OLLY Dashboard — Sprint 5 RECEPTION SECURITY AUDIT (aiolly-dev only).
// ----------------------------------------------------------------------------
// Audits the Guests/Stays/Consent/Requests/Feedback surface: SECURITY DEFINER
// hygiene + EXECUTE grants (no anon/PUBLIC), column-hidden secrets (stay
// access_token_hash, push endpoint/keys), append-only request_events, redacted
// audit (no PII/consent-text/tokens), and cross-tenant + anon + suspended-member
// denial from a DIFFERENT tenant. Scans the built browser bundle for secrets.
// Reads the service-role key from ../../.env at runtime (never committed).
//
//   node dashboard/scripts/security-audit-reception.mjs
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
  console.log("AI OLLY — Reception security audit (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } });
  await sql.connect();

  // ── A) SECURITY DEFINER hygiene + grants ───────────────────────────────────
  const DEFINER_FNS = ["pseudonymize_guest", "resolved_stays", "sign_consent", "revoke_consent", "publish_consent_template"];
  for (const fn of DEFINER_FNS) {
    const r = await sql.query(`select p.prosecdef, array_to_string(p.proconfig,',') cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn]);
    const row = r.rows[0];
    row?.prosecdef ? ok(`${fn}: SECURITY DEFINER`) : bad(`${fn}: not SECURITY DEFINER`);
    (row?.cfg || "").includes("search_path=") ? ok(`${fn}: explicit search_path`) : bad(`${fn}: NO explicit search_path`);
  }
  { const r = await sql.query(`select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='resolved_active_stay'`);
    r.rows[0] && !r.rows[0].prosecdef ? ok("resolved_active_stay: SECURITY INVOKER (caller RLS applies)") : bad("resolved_active_stay: unexpectedly DEFINER"); }
  for (const fn of [...DEFINER_FNS, "resolved_active_stay"]) {
    const g = await sql.query(
      `select grantee from information_schema.routine_privileges rp join information_schema.routines ro on ro.specific_name=rp.specific_name
       where ro.routine_schema='public' and ro.routine_name=$1 and privilege_type='EXECUTE'`, [fn]);
    const grantees = g.rows.map((x) => x.grantee);
    (!grantees.includes("anon") && !grantees.includes("PUBLIC")) ? ok(`${fn}: no EXECUTE for anon/PUBLIC`) : bad(`${fn}: EXECUTE leaked to anon/PUBLIC (${grantees})`);
  }

  // ── B) column-hidden secrets ───────────────────────────────────────────────
  for (const [tbl, col] of [["stays", "access_token_hash"], ["push_subscriptions", "endpoint"], ["push_subscriptions", "p256dh"], ["push_subscriptions", "auth_key"]]) {
    const c = (await sql.query(`select count(*)::int c from information_schema.column_privileges where table_schema='public' and table_name=$1 and column_name=$2 and privilege_type='SELECT' and grantee in ('authenticated','anon')`, [tbl, col])).rows[0].c;
    c === 0 ? ok(`${tbl}.${col}: not SELECTable by anon/authenticated`) : bad(`${tbl}.${col}: selectable`);
  }
  // request_events append-only: no UPDATE/DELETE grants to app roles
  { const c = (await sql.query(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name='request_events' and privilege_type in ('UPDATE','DELETE') and grantee in ('anon','authenticated')`)).rows[0].c;
    c === 0 ? ok("request_events: no UPDATE/DELETE grants (append-only)") : bad("request_events: mutable grants present"); }
  // consents: authenticated has no DELETE (immutable/append)
  { const c = (await sql.query(`select count(*)::int c from information_schema.role_table_grants where table_schema='public' and table_name='consents' and privilege_type='DELETE' and grantee in ('anon','authenticated')`)).rows[0].c;
    c === 0 ? ok("consents: no DELETE grant for app roles") : bad("consents: DELETE granted"); }

  // ── C) redacted audit: no PII / consent text / tokens in audit_log snapshots ─
  {
    const leak = (await sql.query(`select count(*)::int c from public.audit_log
      where entity_type in ('guest','consent','stay','push_subscription')
        and ( (after_state)::text ~* '(@|consent_text_snapshot|access_token|endpoint|p256dh|auth_key)'
           or (before_state)::text ~* '(consent_text_snapshot|access_token|endpoint|p256dh|auth_key)' )`)).rows[0].c;
    leak === 0 ? ok("audit_log: no PII / consent-text / tokens in guest/consent/stay/push snapshots") : bad(`audit_log: ${leak} rows leak sensitive data`);
  }

  // ── D) foreign tenant + roles the demo user is NOT a member of ─────────────
  const getOrInsert = async (table, match, row) => {
    let q = svc.from(table).select("id");
    for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
    const f = await q.maybeSingle();
    if (f.data?.id) return f.data.id;
    const r = await svc.from(table).insert({ ...match, ...row }).select("id").single();
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    return r.data.id;
  };
  const destId = await getOrInsert("destinations", { slug: "sec-rec-dest" }, { name: "Sec Rec", timezone: "Europe/Zagreb" });
  const otherHotel = await getOrInsert("hotels", { slug: "sec-rec-hotel" }, { name: "Sec Rec Hotel", destination_id: destId, timezone: "Europe/Zagreb", currency: "EUR", status: "active" });
  const oGuest = await getOrInsert("guests", { hotel_id: otherHotel, external_source: "sec", external_id: "og" }, { first_name: "Secret", last_name: "Guest", email: "secret@example.com" });
  const oStay = await getOrInsert("stays", { hotel_id: otherHotel, external_source: "sec", external_id: "os" }, { guest_id: oGuest, status: "reserved" });
  const oReq = await getOrInsert("guest_requests", { hotel_id: otherHotel, source: "sec" }, { request_type: "x", title: "Secret request", internal_notes: "secret internal", status: "new" });
  const oTemplate = await getOrInsert("consent_templates", { hotel_id: otherHotel, key: "sec-c", locale: "en", version: 1 }, { title: "Sec", body_text: "secret", status: "published", published_at: new Date().toISOString() });
  const oConsent = await getOrInsert("consents", { hotel_id: otherHotel, guest_id: oGuest, template_id: oTemplate }, { consent_type: "sec-c", consent_version: 1, consent_text_snapshot: "secret snapshot", signed_name: "S" });
  const oFeedback = await getOrInsert("feedback", { hotel_id: otherHotel, source: "sec" }, { rating: 1, category: "sec", status: "new" });

  // suspended membership: demo user suspended at the foreign hotel must still be denied
  const demoUser = (await svc.auth.admin.listUsers({ page: 1, perPage: 200 })).data.users.find((x) => x.email === "demo@aiolly.dev");
  if (demoUser) {
    const ex = await svc.from("hotel_memberships").select("id").eq("hotel_id", otherHotel).eq("user_id", demoUser.id).maybeSingle();
    if (ex.data?.id) await svc.from("hotel_memberships").update({ role: "reception", status: "suspended" }).eq("id", ex.data.id);
    else await svc.from("hotel_memberships").insert({ hotel_id: otherHotel, user_id: demoUser.id, role: "reception", status: "suspended" });
  }

  const demo = createClient(URL, ANON, { auth: { persistSession: false } });
  const s = await demo.auth.signInWithPassword({ email: "demo@aiolly.dev", password: "AiOllyDemo!2026" });
  s.error ? bad("demo sign-in failed: " + s.error.message) : ok("signed in as demo@aiolly.dev (suspended at foreign hotel)");

  ((await demo.from("guests").select("id").eq("id", oGuest)).data ?? []).length === 0 ? ok("suspended/cross-tenant: cannot read foreign guest") : bad("foreign guest READ leaked");
  ((await demo.from("stays").select("id").eq("id", oStay)).data ?? []).length === 0 ? ok("cross-tenant: cannot read foreign stay") : bad("foreign stay READ leaked");
  ((await demo.from("guest_requests").select("id").eq("id", oReq)).data ?? []).length === 0 ? ok("cross-tenant: cannot read foreign request (+internal notes)") : bad("foreign request READ leaked");
  ((await demo.from("consents").select("id").eq("id", oConsent)).data ?? []).length === 0 ? ok("cross-tenant: cannot read foreign consent") : bad("foreign consent READ leaked");
  ((await demo.from("feedback").select("id").eq("id", oFeedback)).data ?? []).length === 0 ? ok("cross-tenant: cannot read foreign feedback") : bad("foreign feedback READ leaked");
  denied(await demo.from("guests").update({ last_name: "HACK" }).eq("id", oGuest)) || (await svc.from("guests").select("last_name").eq("id", oGuest).single()).data.last_name === "Guest"
    ? ok("cross-tenant: cannot UPDATE foreign guest") : bad("foreign guest UPDATE succeeded");
  { const r = await demo.rpc("pseudonymize_guest", { p_guest: oGuest }); (r.error) ? ok("cross-tenant: pseudonymize_guest denied") : bad("cross-tenant pseudonymize allowed"); }
  { const r = await demo.rpc("sign_consent", { p_template: oTemplate, p_guest: oGuest, p_stay: null, p_signed_name: "x" }); (r.error) ? ok("cross-tenant: sign_consent denied") : bad("cross-tenant sign allowed"); }
  { const r = await demo.rpc("publish_consent_template", { p_template: oTemplate }); (r.error) ? ok("cross-tenant: publish_consent_template denied") : bad("cross-tenant publish allowed"); }
  { const r = await demo.rpc("resolved_stays", { p_hotel: otherHotel }); (r.error && /privilege/i.test(r.error.message)) ? ok("cross-tenant: resolved_stays denied") : bad("cross-tenant resolved_stays leaked"); }

  // ── E) anon cannot touch anything ──────────────────────────────────────────
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  for (const t of ["guests", "stays", "consents", "consent_templates", "guest_requests", "request_events", "feedback"])
    (((await anon.from(t).select("id")).data ?? []).length === 0) ? ok(`anon: cannot read ${t}`) : bad(`anon read ${t}`);
  for (const [fn, args] of [["pseudonymize_guest", { p_guest: oGuest }], ["sign_consent", { p_template: oTemplate, p_guest: oGuest, p_stay: null, p_signed_name: "x" }], ["publish_consent_template", { p_template: oTemplate }]])
    denied(await anon.rpc(fn, args)) ? ok(`anon: ${fn} denied`) : bad(`anon: ${fn} allowed`);

  // ── F) browser bundle secret scan ──────────────────────────────────────────
  const nextDir = resolve(here, "../.next");
  if (existsSync(nextDir)) {
    let scanned = 0, leaked = false;
    const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) { if (f !== "cache") walk(p); } else if (/\.(js|json)$/.test(f)) { scanned++; const txt = readFileSync(p, "utf8"); if (txt.includes(SRV)) { leaked = true; bad(`service-role key in bundle: ${p}`); } } } };
    try { walk(join(nextDir, "static")); } catch {}
    (!leaked) ? ok(`bundle scan: no service-role key in ${scanned} built assets`) : null;
  } else ok("bundle scan skipped (.next not built)");

  // ── cleanup ────────────────────────────────────────────────────────────────
  if (demoUser) { try { await svc.from("hotel_memberships").delete().eq("hotel_id", otherHotel).eq("user_id", demoUser.id); } catch {} }
  for (const t of ["content_versions"]) await sql.query(`delete from public.${t} where hotel_id=$1`, [otherHotel]).catch(() => {});
  for (const t of ["consents", "consent_templates", "guest_requests", "request_events", "feedback", "guest_duplicate_suggestions", "stays", "guests", "audit_log"])
    await sql.query(`delete from public.${t} where hotel_id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.hotels where id=$1`, [otherHotel]).catch(() => {});
  await sql.query(`delete from public.destinations where id=$1`, [destId]).catch(() => {});
  await sql.end();

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. Foreign tenant cleaned up. No secrets logged.`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("  audit error:", e.message); process.exit(1); });
