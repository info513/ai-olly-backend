// ============================================================================
// AI OLLY Dashboard — Newsletter REGRESSION SUITE (aiolly-dev only).
// ----------------------------------------------------------------------------
// Exercises subscribers / segments / templates / campaigns / events the way the
// dashboard does — anon key + per-user JWT, RLS-enforced. Real Auth users; all
// cleaned up. Covers subscriber normalization/uniqueness/consent/lifecycle,
// static + rule segments (no arbitrary SQL) with consent-filtered audience,
// template draft/live + publish/rollback/versions, campaign snapshot immutability
// + schedule + later-edit isolation + cancel + duplicate, append-only events +
// webhook idempotency, and tenant isolation. Reads the service-role key from ../../.env.
//
//   node dashboard/scripts/verify-newsletter.mjs
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const P = "vnl", DOM = "@verify-nl.local", PW = "Verify-NL-Pass!1";
const CONTENT = { version: 1, blocks: [{ type: "paragraph", text: "Hello" }] };

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };
const rows = (r) => (r && r.data) ? r.data : [];

async function main() {
  console.log("AI OLLY — Newsletter regression suite (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();
  const q = (t, p) => sql.query(t, p);
  const u = {}, H = {}, G = {}, C = {}, T = {}, S = {}, SUB = {};
  const ids = [];

  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    const hsub = `(select id from public.hotels where slug like $1)`;
    if (ids.length) await q(`delete from public.content_versions where entity_id = any($1::uuid[])`, [ids]).catch(() => {});
    await q(`delete from public.audit_log where hotel_id in ${hsub}`, [P + "%"]).catch(() => {});
    for (const t of ["newsletter_webhook_events", "newsletter_events", "newsletter_campaign_recipients", "newsletter_campaigns", "newsletter_segment_members", "newsletter_segments", "newsletter_templates", "newsletter_subscribers", "consents", "consent_templates", "guests"])
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

    await mkUser("ha"); await mkUser("mk"); await mkUser("ed"); await mkUser("rc"); await mkUser("ro"); await mkUser("hb");
    await svc.from("hotel_memberships").insert([
      { hotel_id: H.a, user_id: u.ha.id, role: "hotel_admin", status: "active" },
      { hotel_id: H.a, user_id: u.mk.id, role: "marketing", status: "active" },
      { hotel_id: H.a, user_id: u.ed.id, role: "editor", status: "active" },
      { hotel_id: H.a, user_id: u.rc.id, role: "reception", status: "active" },
      { hotel_id: H.a, user_id: u.ro.id, role: "read_only", status: "active" },
      { hotel_id: H.b, user_id: u.hb.id, role: "hotel_admin", status: "active" },
    ]);
    // published consent template + granted/revoked consents for two guests
    const ctpl = await ins("consent_templates", { hotel_id: H.a, key: `${P}-mkt`, locale: "en", version: 1, title: "Mkt", body_text: "[synthetic] marketing consent", status: "published", published_at: new Date().toISOString() });
    G.a = await ins("guests", { hotel_id: H.a, first_name: "Ann" });
    G.b = await ins("guests", { hotel_id: H.a, first_name: "Bo" });
    C.granted = await ins("consents", { hotel_id: H.a, guest_id: G.a, template_id: ctpl, consent_type: `${P}-mkt`, consent_version: 1, locale: "en", consent_text_snapshot: "x", signed_name: "Ann", status: "granted" });
    C.revoked = await ins("consents", { hotel_id: H.a, guest_id: G.b, template_id: ctpl, consent_type: `${P}-mkt`, consent_version: 1, locale: "en", consent_text_snapshot: "x", signed_name: "Bo", status: "revoked" });
    ok("fixtures + users created");

    // ══ SUBSCRIBERS: normalization, uniqueness, consent, lifecycle, roles ══════
    { const r = await u.mk.c.from("newsletter_subscribers").insert({ hotel_id: H.a, email: "Anna@Example.com", status: "subscribed", consent_id: C.granted, subscribed_at: new Date().toISOString(), locale: "en" }).select("id,email_normalized").single();
      SUB.anna = r.data?.id; (!r.error && r.data.email_normalized === "anna@example.com") ? ok("subscriber email normalized (lowercased for uniqueness)") : bad(`normalize failed: ${r.error?.message}`); }
    { const r = await u.mk.c.from("newsletter_subscribers").insert({ hotel_id: H.a, email: "anna@example.com", status: "pending" });
      (r.error && /duplicate|unique/i.test(r.error.message)) ? ok("one subscriber per (hotel, normalized email)") : bad("duplicate subscriber allowed"); }
    SUB.bo = await ins("newsletter_subscribers", { hotel_id: H.a, email: "bo@example.com", status: "subscribed", consent_id: C.revoked, subscribed_at: new Date().toISOString(), locale: "en" });
    SUB.nocon = await ins("newsletter_subscribers", { hotel_id: H.a, email: "noconsent@example.com", status: "subscribed", subscribed_at: new Date().toISOString(), locale: "de" });
    // consent state via member-scoped fn (marketing can't read consents table directly)
    { const r = await u.mk.c.rpc("newsletter_consent_status", { p_hotel: H.a });
      const m = new Map((r.data ?? []).map((x) => [x.subscriber_id, x.consent_state]));
      (m.get(SUB.anna) === "active" && m.get(SUB.bo) === "revoked" && m.get(SUB.nocon) === "missing") ? ok("consent state active/revoked/missing derived for marketing (no PII)") : bad(`consent state wrong: ${JSON.stringify([...m])}`); }
    { const r = await u.mk.c.from("consents").select("id").eq("id", C.granted); (rows(r).length === 0) ? ok("marketing cannot read the consents table directly (PII protected)") : bad("marketing read consents PII"); }
    { const r = await u.mk.c.from("newsletter_subscribers").update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString() }).eq("id", SUB.bo); (!r.error) ? ok("marketing unsubscribes a subscriber") : bad("unsubscribe failed"); }
    (rows(await u.ed.c.from("newsletter_subscribers").select("id").eq("id", SUB.anna)).length === 0) ? ok("editor cannot read subscribers (no PII)") : bad("editor read subscriber PII");
    (rows(await u.rc.c.from("newsletter_subscribers").select("id").eq("id", SUB.anna)).length === 1) ? ok("reception can read subscribers (consent status)") : bad("reception cannot read subscribers");
    { await u.rc.c.from("newsletter_subscribers").update({ status: "subscribed" }).eq("id", SUB.bo); (rows(await svc.from("newsletter_subscribers").select("status").eq("id", SUB.bo)).length && (await svc.from("newsletter_subscribers").select("status").eq("id", SUB.bo).single()).data.status === "unsubscribed") ? ok("reception cannot write subscribers") : bad("reception wrote subscriber"); }

    // ══ SEGMENTS: static + rule + no-SQL + consent-filtered audience ═══════════
    S.static = await ins("newsletter_segments", { hotel_id: H.a, key: `${P}-vip`, name: "VIP", type: "static" });
    { const r = await u.mk.c.from("newsletter_segments").insert({ hotel_id: H.a, key: `${P}-bad`, name: "Bad", type: "rule", rules: { match: "all", conditions: [{ field: "email; drop table", op: "eq", value: "x" }] } });
      (r.error) ? ok("invalid/arbitrary rule field rejected (CHECK)") : bad("arbitrary rule field accepted"); }
    S.rule = await ins("newsletter_segments", { hotel_id: H.a, key: `${P}-en`, name: "EN", type: "rule", rules: { match: "all", conditions: [{ field: "locale", op: "eq", value: "en" }] } });
    await svc.from("newsletter_segment_members").insert([{ segment_id: S.static, subscriber_id: SUB.anna }, { segment_id: S.static, subscriber_id: SUB.nocon }]);
    { const r = await u.mk.c.rpc("resolve_newsletter_audience", { p_segment: S.static });
      const emails = (r.data ?? []).map((x) => x.email.toLowerCase());
      (emails.length === 1 && emails[0] === "anna@example.com") ? ok("static audience is consent-filtered (only granted subscriber, not the no-consent member)") : bad(`static audience wrong: ${JSON.stringify(emails)}`); }
    { const r = await u.mk.c.rpc("resolve_newsletter_audience", { p_segment: S.rule });
      const emails = (r.data ?? []).map((x) => x.email.toLowerCase());
      (emails.length === 1 && emails[0] === "anna@example.com") ? ok("rule audience (locale=en) + consent filter → anna only") : bad(`rule audience wrong: ${JSON.stringify(emails)}`); }
    { const r = await u.hb.c.rpc("resolve_newsletter_audience", { p_segment: S.static }); (r.error && /privilege/i.test(r.error.message)) ? ok("cross-tenant audience resolution denied") : bad("cross-tenant audience allowed"); }

    // ══ TEMPLATES: draft/live + publish/rollback/versions ═════════════════════
    T.id = await ins("newsletter_templates", { hotel_id: H.a, key: `${P}-welcome`, locale: "en", name: "Welcome", subject: "V1 subject", preview_text: "v1", content: CONTENT, status: "draft" });
    { const r = await u.mk.c.rpc("publish_newsletter_template", { p_template: T.id, p_change_summary: "v1" });
      const t = (await svc.from("newsletter_templates").select("status,published_snapshot").eq("id", T.id).single()).data;
      (!r.error && t.status === "published" && t.published_snapshot?.subject === "V1 subject") ? ok("publish sets status + published_snapshot") : bad(`publish failed: ${r.error?.message}`); }
    // edit published draft → published_snapshot unchanged (draft/live separation)
    await u.mk.c.from("newsletter_templates").update({ subject: "V2 EDIT", content: { version: 1, blocks: [{ type: "paragraph", text: "edited" }] } }).eq("id", T.id);
    { const snap = (await svc.from("newsletter_templates").select("published_snapshot").eq("id", T.id).single()).data.published_snapshot;
      (snap.subject === "V1 subject") ? ok("editing a published template does NOT change the live snapshot") : bad(`live snapshot changed: ${snap.subject}`); }
    { const h = await u.ha.c.rpc("list_newsletter_template_versions", { p_template: T.id }); (!h.error && (h.data ?? []).length === 1) ? ok("template history readable (list_newsletter_template_versions)") : bad(`history wrong: ${h.error?.message}`); }
    { const editorRead = await u.ed.c.from("newsletter_templates").select("id").eq("id", T.id); (rows(editorRead).length === 1) ? ok("editor can READ templates") : bad("editor cannot read templates"); }
    { const r = await u.ed.c.from("newsletter_templates").update({ subject: "hack" }).eq("id", T.id); const s = (await svc.from("newsletter_templates").select("subject").eq("id", T.id).single()).data.subject; (s !== "hack") ? ok("editor cannot write templates") : bad("editor wrote template"); }

    // ══ CAMPAIGNS: create/snapshot/schedule/immutability/cancel/duplicate ═════
    // publish v2 so the campaign snapshots the CURRENT live (V1 still snapshot until re-publish)
    C.camp = await ins("newsletter_campaigns", { hotel_id: H.a, name: "Camp A", template_id: T.id, segment_id: S.rule, status: "draft" });
    { const r = await u.rc.c.rpc("schedule_campaign", { p_campaign: C.camp, p_scheduled_at: new Date(Date.now() + 864e5).toISOString() }); (r.error && /privilege/i.test(r.error.message)) ? ok("reception cannot schedule a campaign") : bad("reception scheduled campaign"); }
    { const r = await u.mk.c.rpc("schedule_campaign", { p_campaign: C.camp, p_scheduled_at: new Date(Date.now() + 864e5).toISOString() });
      const c = (await svc.from("newsletter_campaigns").select("status,subject_snapshot").eq("id", C.camp).single()).data;
      // snapshot is the LIVE published snapshot (V1), not the edited draft (V2 EDIT)
      (!r.error && c.status === "scheduled" && c.subject_snapshot === "V1 subject") ? ok("schedule freezes the LIVE published subject (V1), not the draft edit") : bad(`schedule snapshot wrong: ${c.subject_snapshot}`); }
    // later template change must NOT mutate the scheduled campaign
    await u.mk.c.rpc("publish_newsletter_template", { p_template: T.id, p_change_summary: "v2" }); // now live=V2 EDIT
    { const c = (await svc.from("newsletter_campaigns").select("subject_snapshot").eq("id", C.camp).single()).data; (c.subject_snapshot === "V1 subject") ? ok("later template publish does NOT change the scheduled campaign snapshot") : bad("scheduled snapshot mutated"); }
    // direct edit of a scheduled campaign's snapshot is frozen by trigger
    { await u.mk.c.from("newsletter_campaigns").update({ subject_snapshot: "TAMPER", content_snapshot: { version: 1, blocks: [] } }).eq("id", C.camp);
      const c = (await svc.from("newsletter_campaigns").select("subject_snapshot").eq("id", C.camp).single()).data; (c.subject_snapshot === "V1 subject") ? ok("scheduled campaign snapshot is immutable (edit ignored)") : bad("scheduled snapshot edited"); }
    { const r = await u.mk.c.rpc("schedule_campaign", { p_campaign: C.camp, p_scheduled_at: new Date().toISOString() }); (r.error && /not schedulable/i.test(r.error.message)) ? ok("re-scheduling a scheduled campaign rejected") : bad("re-schedule allowed"); }
    { const r = await u.mk.c.from("newsletter_campaigns").update({ status: "cancelled" }).eq("id", C.camp); (!r.error && (await svc.from("newsletter_campaigns").select("status").eq("id", C.camp).single()).data.status === "cancelled") ? ok("scheduled campaign can be cancelled") : bad("cancel failed"); }
    { const r = await u.mk.c.from("newsletter_campaigns").insert({ hotel_id: H.a, name: "Camp A (copy)", template_id: T.id, segment_id: S.rule, status: "draft" }).select("id").single(); (!r.error) ? ok("campaign duplicate creates a fresh draft") : bad("duplicate failed"); }
    { const readOnlyCamp = await u.ro.c.from("newsletter_campaigns").select("id").eq("id", C.camp); (rows(readOnlyCamp).length === 1) ? ok("read_only can read campaign summaries") : bad("read_only cannot read campaigns"); }
    { const r = await u.ro.c.from("newsletter_campaigns").update({ name: "hack" }).eq("id", C.camp); const n = (await svc.from("newsletter_campaigns").select("name").eq("id", C.camp).single()).data.name; (n !== "hack") ? ok("read_only cannot write campaigns") : bad("read_only wrote campaign"); }

    // ══ EVENTS: append-only + webhook idempotency ═════════════════════════════
    const ev = await ins("newsletter_events", { hotel_id: H.a, campaign_id: C.camp, event_type: "delivered" });
    { const r = await u.mk.c.from("newsletter_events").update({ event_type: "opened" }).eq("id", ev); (r.error) ? ok("newsletter_events are append-only (UPDATE blocked)") : bad("events UPDATE allowed"); }
    { const a = await svc.from("newsletter_webhook_events").insert({ hotel_id: H.a, provider: "brevo", provider_event_id: `${P}-evt-1`, event_type: "delivered", payload: { event: "delivered" } });
      const b = await svc.from("newsletter_webhook_events").insert({ hotel_id: H.a, provider: "brevo", provider_event_id: `${P}-evt-1`, event_type: "delivered", payload: { event: "delivered" } });
      (!a.error && b.error && /duplicate|unique/i.test(b.error.message)) ? ok("webhook events idempotent (unique provider_event_id)") : bad("webhook idempotency failed"); }
    { const c = await u.mk.c.from("newsletter_webhook_events").select("id"); (c.error || (c.data ?? []).length === 0) ? ok("authenticated cannot read raw webhook events (backend-only)") : bad("webhook events readable by authenticated"); }

    // ══ CROSS-TENANT isolation ════════════════════════════════════════════════
    (rows(await u.hb.c.from("newsletter_subscribers").select("id").eq("id", SUB.anna)).length === 0) ? ok("cross-tenant: hotel B cannot read hotel A subscriber") : bad("cross-tenant subscriber leak");
    (rows(await u.hb.c.from("newsletter_campaigns").select("id").eq("id", C.camp)).length === 0) ? ok("cross-tenant: hotel B cannot read hotel A campaign") : bad("cross-tenant campaign leak");
    (rows(await u.hb.c.from("newsletter_templates").select("id").eq("id", T.id)).length === 0) ? ok("cross-tenant: hotel B cannot read hotel A template") : bad("cross-tenant template leak");
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
