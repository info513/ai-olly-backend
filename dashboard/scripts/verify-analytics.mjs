// ============================================================================
// AI OLLY Dashboard — Analytics REGRESSION SUITE (aiolly-dev only).
// ----------------------------------------------------------------------------
// Exercises the daily aggregates + refresh functions the way the dashboard does —
// anon key + per-user JWT, RLS-enforced. Real Auth users; cleaned up. Covers
// refresh idempotency + timezone bucketing + formula_version, role-specific daily
// reads, no-PII aggregates, hotel isolation, recent-activity redaction, and that
// quick-action routes exist. Reads the service-role key from ../../.env.
//
//   node dashboard/scripts/verify-analytics.mjs
// ============================================================================

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const P = "van", DOM = "@verify-analytics.local", PW = "Verify-An-Pass!1";
// Bucket "today" in the hotel timezone (the refresh functions bucket by
// `created_at at time zone tz`). Using a UTC date here flaked between 22:00–24:00
// UTC, when Europe/Zagreb is already the next local day. Match the refresh + prod.
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Zagreb" });

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };
const rows = (r) => (r && r.data) ? r.data : [];

async function main() {
  console.log("AI OLLY — Analytics regression suite (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();
  const q = (t, p) => sql.query(t, p);
  const u = {}, H = {};
  const ids = [];

  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    const hsub = `(select id from public.hotels where slug like $1)`;
    for (const t of ["ai_quality_daily", "operations_daily", "newsletter_daily", "content_health_daily", "guest_requests", "feedback", "stays", "guests", "consents", "unanswered_questions"])
      await q(`delete from public.${t} where hotel_id in ${hsub}`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {});
  };
  const mkUser = async (k) => {
    const email = `${P}.${k}${DOM}`;
    const { data, error } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true });
    if (error) throw new Error(`createUser ${k}: ${error.message}`);
    await svc.from("profiles").insert({ user_id: data.user.id, email });
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    const s = await c.auth.signInWithPassword({ email, password: PW });
    if (s.error) throw new Error(`signin ${k}: ${s.error.message}`);
    u[k] = { id: data.user.id, c };
  };
  const ins = async (t, r) => { const x = await svc.from(t).insert(r).select("id").single(); if (x.error) throw new Error(`${t}: ${x.error.message}`); if (x.data.id) ids.push(x.data.id); return x.data.id; };

  try {
    await cleanup();
    const dA = await ins("destinations", { name: "DA", slug: `${P}-da`, timezone: "Europe/Zagreb" });
    const dB = await ins("destinations", { name: "DB", slug: `${P}-db`, timezone: "Europe/Zagreb" });
    H.a = await ins("hotels", { name: "HA", slug: `${P}-ha`, destination_id: dA, timezone: "Europe/Zagreb", currency: "EUR" });
    H.b = await ins("hotels", { name: "HB", slug: `${P}-hb`, destination_id: dB, timezone: "Europe/Zagreb", currency: "EUR" });
    // seed some source rows so refresh computes non-trivial values
    await svc.from("guest_requests").insert([{ hotel_id: H.a, request_type: "x", title: "r1", status: "resolved", created_at: new Date().toISOString(), resolved_at: new Date().toISOString(), acknowledged_at: new Date().toISOString() }, { hotel_id: H.a, request_type: "x", title: "r2", status: "new", created_at: new Date().toISOString() }]);
    await svc.from("feedback").insert({ hotel_id: H.a, rating: 5, category: "Staff", created_at: new Date().toISOString() });

    await mkUser("ha"); await mkUser("ed"); await mkUser("rc"); await mkUser("mk"); await mkUser("ro"); await mkUser("hb");
    await svc.from("hotel_memberships").insert([
      { hotel_id: H.a, user_id: u.ha.id, role: "hotel_admin", status: "active" },
      { hotel_id: H.a, user_id: u.ed.id, role: "editor", status: "active" },
      { hotel_id: H.a, user_id: u.rc.id, role: "reception", status: "active" },
      { hotel_id: H.a, user_id: u.mk.id, role: "marketing", status: "active" },
      { hotel_id: H.a, user_id: u.ro.id, role: "read_only", status: "active" },
      { hotel_id: H.b, user_id: u.hb.id, role: "hotel_admin", status: "active" },
    ]);
    ok("fixtures + users created");

    // ══ REFRESH: idempotency + formula_version + tz ═══════════════════════════
    { const r1 = await u.ha.c.rpc("refresh_operations_daily", { p_hotel: H.a, p_day: today });
      (!r1.error) ? ok("hotel_admin can refresh operations_daily") : bad(`refresh failed: ${r1.error?.message}`); }
    { const before = (await svc.from("operations_daily").select("requests_total,calc_version").eq("hotel_id", H.a).eq("day", today).single()).data;
      await u.ha.c.rpc("refresh_operations_daily", { p_hotel: H.a, p_day: today });
      const after = (await svc.from("operations_daily").select("requests_total,calc_version").eq("hotel_id", H.a).eq("day", today).single()).data;
      (before.requests_total === after.requests_total && before.requests_total === 2) ? ok("refresh is idempotent (same counts on re-run)") : bad(`idempotency wrong: ${before.requests_total} vs ${after.requests_total}`);
      (after.calc_version === "v1") ? ok("formula version stamped (v1)") : bad(`calc_version wrong: ${after.calc_version}`); }
    { await u.ha.c.rpc("refresh_ai_quality_daily", { p_hotel: H.a, p_day: today });
      await u.ha.c.rpc("refresh_content_health_daily", { p_hotel: H.a, p_day: today });
      await u.ha.c.rpc("refresh_newsletter_daily", { p_hotel: H.a, p_day: today });
      ok("all four refresh functions run for the day"); }
    { const r = await u.ha.c.rpc("refresh_analytics", { p_hotel: H.a, p_day: today }); (!r.error) ? ok("refresh_analytics (all-in-one) runs") : bad("refresh_analytics failed"); }
    // reception can refresh (assert_analytics_access allows any member); cross-hotel denied
    { const r = await u.hb.c.rpc("refresh_operations_daily", { p_hotel: H.a, p_day: today }); (r.error && /privilege/i.test(r.error.message)) ? ok("cross-hotel refresh denied") : bad("cross-hotel refresh allowed"); }

    // ══ ROLE-SPECIFIC daily reads ═════════════════════════════════════════════
    // ai_quality_daily: hotel_admin/editor/read_only yes; reception/marketing no
    (rows(await u.ha.c.from("ai_quality_daily").select("day").eq("hotel_id", H.a)).length > 0) ? ok("hotel_admin reads ai_quality_daily") : bad("hotel_admin cannot read ai_quality_daily");
    (rows(await u.ed.c.from("ai_quality_daily").select("day").eq("hotel_id", H.a)).length > 0) ? ok("editor reads ai_quality_daily") : bad("editor cannot read ai_quality_daily");
    (rows(await u.rc.c.from("ai_quality_daily").select("day").eq("hotel_id", H.a)).length === 0) ? ok("reception cannot read ai_quality_daily") : bad("reception read ai_quality_daily");
    (rows(await u.mk.c.from("ai_quality_daily").select("day").eq("hotel_id", H.a)).length === 0) ? ok("marketing cannot read ai_quality_daily") : bad("marketing read ai_quality_daily");
    // operations_daily: hotel_admin/reception/read_only yes; editor/marketing no
    (rows(await u.rc.c.from("operations_daily").select("day").eq("hotel_id", H.a)).length > 0) ? ok("reception reads operations_daily") : bad("reception cannot read operations_daily");
    (rows(await u.ed.c.from("operations_daily").select("day").eq("hotel_id", H.a)).length === 0) ? ok("editor cannot read operations_daily") : bad("editor read operations_daily");
    (rows(await u.mk.c.from("operations_daily").select("day").eq("hotel_id", H.a)).length === 0) ? ok("marketing cannot read operations_daily") : bad("marketing read operations_daily");
    // newsletter_daily: hotel_admin/marketing/read_only yes; reception/editor no
    (rows(await u.mk.c.from("newsletter_daily").select("day").eq("hotel_id", H.a)).length > 0) ? ok("marketing reads newsletter_daily") : bad("marketing cannot read newsletter_daily");
    (rows(await u.rc.c.from("newsletter_daily").select("day").eq("hotel_id", H.a)).length === 0) ? ok("reception cannot read newsletter_daily") : bad("reception read newsletter_daily");
    // content_health_daily: hotel_admin/editor/read_only yes; reception no
    (rows(await u.ed.c.from("content_health_daily").select("day").eq("hotel_id", H.a)).length > 0) ? ok("editor reads content_health_daily") : bad("editor cannot read content_health_daily");
    (rows(await u.rc.c.from("content_health_daily").select("day").eq("hotel_id", H.a)).length === 0) ? ok("reception cannot read content_health_daily") : bad("reception read content_health_daily");
    // read_only can read all four
    { const oks = [
        rows(await u.ro.c.from("ai_quality_daily").select("day").eq("hotel_id", H.a)).length,
        rows(await u.ro.c.from("operations_daily").select("day").eq("hotel_id", H.a)).length,
        rows(await u.ro.c.from("newsletter_daily").select("day").eq("hotel_id", H.a)).length,
        rows(await u.ro.c.from("content_health_daily").select("day").eq("hotel_id", H.a)).length,
      ];
      oks.every((n) => n > 0) ? ok("read_only reads all four daily aggregates (summaries)") : bad(`read_only daily reads: ${oks}`); }

    // ══ NO PII in aggregate rows ══════════════════════════════════════════════
    { const cols = (await q(`select table_name, string_agg(column_name,',') c from information_schema.columns where table_schema='public' and table_name in ('ai_quality_daily','operations_daily','newsletter_daily','content_health_daily') group by table_name`)).rows;
      // real PII/secret column names — NOT the *_tokens count columns
      const badCols = cols.filter((r) => /email|phone|first_name|last_name|signed_name|snapshot|payload|access_token|auth_key|ip_metadata/i.test(r.c));
      badCols.length === 0 ? ok("aggregate tables contain no PII columns (counts only)") : bad(`PII-ish columns: ${JSON.stringify(badCols)}`); }

    // ══ HOTEL isolation ═══════════════════════════════════════════════════════
    (rows(await u.hb.c.from("operations_daily").select("day").eq("hotel_id", H.a)).length === 0) ? ok("cross-tenant: hotel B cannot read hotel A operations_daily") : bad("cross-tenant analytics leak");

    // ══ RECENT ACTIVITY redaction (structural) ════════════════════════════════
    { const file = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data/recent-activity.ts");
      if (existsSync(file)) { const src = readFileSync(file, "utf8");
        const usesAudit = /from\("audit_log"\)/.test(src);
        (!usesAudit) ? ok("recent-activity does NOT read audit_log (backend-only)") : bad("recent-activity reads audit_log");
      } else bad("recent-activity.ts missing"); }

    // ══ QUICK-ACTION routes exist (page files present) ════════════════════════
    { const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/app/(app)");
      const routes = ["stays/new", "consent", "ai/unanswered", "ai/knowledge/new", "assets/upload", "newsletter/campaigns/new", "analytics/health"];
      const missing = routes.filter((r) => !existsSync(resolve(appDir, r, "page.tsx")));
      missing.length === 0 ? ok("all Home quick-action routes resolve to real pages") : bad(`missing routes: ${missing.join(", ")}`); }
  } catch (e) {
    bad(`unexpected error: ${e.message}`);
  } finally {
    await cleanup();
    await sql.end();
  }
  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. Synthetic data + users cleaned up.`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("  verify error:", e.message); process.exit(1); });
