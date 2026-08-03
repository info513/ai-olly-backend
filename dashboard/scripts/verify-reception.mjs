// ============================================================================
// AI OLLY Dashboard — Reception module REGRESSION SUITE (aiolly-dev only).
// ----------------------------------------------------------------------------
// Exercises Guests / Stays / Consent / Requests / Feedback the way the dashboard
// does — anon key + per-user JWT, RLS-enforced — across roles and tenants. Real
// Auth users; cleaned up. Covers PII scoping, stay lifecycle + cross-hotel guards,
// duplicate review, pseudonymization, request lifecycle + append-only events +
// internal/guest split, the consent draft/live freeze + immutable snapshot +
// revocation, and feedback. Reads the service-role key from ../../.env at runtime.
//
//   node dashboard/scripts/verify-reception.mjs
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
const P = "vr", DOM = "@verify-rec.local", PW = "Verify-Rec-Pass!1";

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };
const rows = (r) => (r && r.data) ? r.data : [];
const denied = (r) => !!(r && r.error);

async function main() {
  console.log("AI OLLY — Reception regression suite (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();
  const q = (t, p) => sql.query(t, p);
  const u = {}, H = {}, RM = {}, G = {}, T = {};
  const ids = [];

  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    const hsub = `(select id from public.hotels where slug like $1)`;
    if (ids.length) await q(`delete from public.content_versions where entity_id = any($1::uuid[])`, [ids]).catch(() => {});
    await q(`delete from public.audit_log where hotel_id in ${hsub}`, [P + "%"]).catch(() => {});
    for (const t of ["request_events", "guest_requests", "feedback", "consents", "consent_templates", "guest_duplicate_suggestions", "stays", "guests", "rooms", "room_types"])
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
    const rtA = await ins("room_types", { hotel_id: H.a, name: "Std", slug: `${P}-rt` });
    const rtB = await ins("room_types", { hotel_id: H.b, name: "Std", slug: `${P}-rtb` });
    RM.a1 = await ins("rooms", { hotel_id: H.a, room_type_id: rtA, room_number: "A101", access_token: `${P}-t1` });
    RM.a2 = await ins("rooms", { hotel_id: H.a, room_type_id: rtA, room_number: "A102", access_token: `${P}-t2` });
    RM.b1 = await ins("rooms", { hotel_id: H.b, room_type_id: rtB, room_number: "B101", access_token: `${P}-tb1` });
    G.a = await ins("guests", { hotel_id: H.a, first_name: "Gina", last_name: "Alpha", email: "gina@example.com", phone: "+100" });
    G.a2 = await ins("guests", { hotel_id: H.a, first_name: "Gina", last_name: "Alpha", email: "g.alpha@example.co" });
    G.b = await ins("guests", { hotel_id: H.b, first_name: "Boris", last_name: "Beta" });

    await mkUser("ha"); await mkUser("rc"); await mkUser("ed"); await mkUser("mk"); await mkUser("ro"); await mkUser("hb");
    await svc.from("hotel_memberships").insert([
      { hotel_id: H.a, user_id: u.ha.id, role: "hotel_admin", status: "active" },
      { hotel_id: H.a, user_id: u.rc.id, role: "reception", status: "active" },
      { hotel_id: H.a, user_id: u.ed.id, role: "editor", status: "active" },
      { hotel_id: H.a, user_id: u.mk.id, role: "marketing", status: "active" },
      { hotel_id: H.a, user_id: u.ro.id, role: "read_only", status: "active" },
      { hotel_id: H.b, user_id: u.hb.id, role: "hotel_admin", status: "active" },
    ]);
    ok("fixtures + users created");

    // ══ GUESTS: PII scoping ═════════════════════════════════════════════════════
    (rows(await u.rc.c.from("guests").select("id,email").eq("id", G.a)).length === 1) ? ok("reception reads guest PII") : bad("reception cannot read guest");
    (rows(await u.ha.c.from("guests").select("id,email").eq("id", G.a)).length === 1) ? ok("hotel_admin reads guest PII") : bad("hotel_admin cannot read guest");
    (rows(await u.ed.c.from("guests").select("id").eq("id", G.a)).length === 0) ? ok("editor cannot read guests (no PII)") : bad("editor read guest PII");
    (rows(await u.mk.c.from("guests").select("id").eq("id", G.a)).length === 0) ? ok("marketing cannot read guests (no PII)") : bad("marketing read guest PII");
    (rows(await u.ro.c.from("guests").select("id").eq("id", G.a)).length === 0) ? ok("read_only cannot read guests (no PII)") : bad("read_only read guest PII");

    // ══ STAYS: create / lifecycle / cross-hotel guards ══════════════════════════
    let stayA;
    { const r = await u.rc.c.from("stays").insert({ hotel_id: H.a, guest_id: G.a, room_id: RM.a1, status: "reserved", arrival_at: new Date().toISOString() }).select("id").single();
      stayA = r.data?.id; (!r.error && stayA) ? ok("reception creates a stay") : bad(`stay create failed: ${r.error?.message}`); }
    { const r = await u.rc.c.from("stays").update({ status: "checked_in", checked_in_at: new Date().toISOString() }).eq("id", stayA);
      const st = (await svc.from("stays").select("status").eq("id", stayA).single()).data.status;
      (!r.error && st === "checked_in") ? ok("reception checks a stay in") : bad(`check-in failed: ${r.error?.message}`); }
    { const r = await u.rc.c.rpc("resolved_active_stay", { p_room: RM.a1 }); ((r.data ?? [])[0]?.stay_id === stayA) ? ok("resolved_active_stay returns the in-house stay (no PII/token)") : bad("resolved_active_stay wrong"); }
    { const r = await u.rc.c.from("stays").update({ room_id: RM.a2 }).eq("id", stayA);
      const rm = (await svc.from("stays").select("room_id").eq("id", stayA).single()).data.room_id;
      (!r.error && rm === RM.a2) ? ok("room reassignment works") : bad(`reassign failed: ${r.error?.message}`); }
    { const r = await u.rc.c.from("stays").update({ room_id: RM.b1 }).eq("id", stayA);
      (r.error && /not in hotel/i.test(r.error.message)) ? ok("cross-hotel room on a stay rejected (trigger)") : bad("cross-hotel room accepted"); }
    { const r = await u.rc.c.from("stays").update({ guest_id: G.b }).eq("id", stayA);
      (r.error && /not in hotel/i.test(r.error.message)) ? ok("cross-hotel guest on a stay rejected (trigger)") : bad("cross-hotel guest accepted"); }
    { const r = await u.rc.c.from("stays").update({ status: "checked_out", checked_out_at: new Date().toISOString() }).eq("id", stayA);
      (!r.error) ? ok("reception checks a stay out") : bad(`check-out failed: ${r.error?.message}`); }
    // stays access_token_hash never selectable
    denied(await u.ha.c.from("stays").select("access_token_hash").limit(1)) ? ok("stays.access_token_hash not selectable") : bad("access_token_hash leaked");
    // editor can read stays (operational context) but not write
    (rows(await u.ed.c.from("stays").select("id").eq("id", stayA)).length === 1) ? ok("editor reads stay (operational context)") : bad("editor cannot read stay");
    { await u.ed.c.from("stays").update({ status: "reserved" }).eq("id", stayA);
      ((await svc.from("stays").select("status").eq("id", stayA).single()).data.status === "checked_out") ? ok("editor cannot write stays") : bad("editor wrote stay"); }

    // ══ DUPLICATE suggestions + pseudonymize ════════════════════════════════════
    const dup = await ins("guest_duplicate_suggestions", { hotel_id: H.a, guest_id: G.a, candidate_guest_id: G.a2, match_reason: "same name", match_score: 0.9, status: "pending" });
    { const r = await u.rc.c.from("guest_duplicate_suggestions").update({ status: "confirmed", reviewed_at: new Date().toISOString() }).eq("id", dup);
      (!r.error && (await svc.from("guest_duplicate_suggestions").select("status").eq("id", dup).single()).data.status === "confirmed") ? ok("reception reviews duplicate (confirm; no merge)") : bad("duplicate review failed"); }
    { const r = await u.rc.c.rpc("pseudonymize_guest", { p_guest: G.a2 }); (r.error && /privilege/i.test(r.error.message)) ? ok("reception cannot pseudonymize (hotel_admin only)") : bad("reception pseudonymized"); }
    { const r = await u.ha.c.rpc("pseudonymize_guest", { p_guest: G.a2 });
      const g = (await svc.from("guests").select("email,pseudonymized_at").eq("id", G.a2).single()).data;
      (!r.error && g.email === null && g.pseudonymized_at) ? ok("hotel_admin pseudonymizes guest (PII stripped)") : bad(`pseudonymize failed: ${r.error?.message}`); }

    // ══ REQUESTS: lifecycle / events / notes / replies / roles ══════════════════
    let req;
    { const r = await u.rc.c.from("guest_requests").insert({ hotel_id: H.a, room_id: RM.a1, guest_id: G.a, request_type: "housekeeping", title: "Towels", status: "new" }).select("id").single();
      req = r.data?.id; (!r.error && req) ? ok("reception creates a request") : bad(`request create failed: ${r.error?.message}`); }
    { const c = (await q(`select count(*)::int c from public.request_events where request_id=$1 and event_type='created'`, [req])).rows[0].c; (c === 1) ? ok("request insert auto-appends a 'created' event") : bad(`created event missing (${c})`); }
    { await u.rc.c.from("guest_requests").update({ status: "acknowledged", acknowledged_at: new Date().toISOString() }).eq("id", req);
      const c = (await q(`select count(*)::int c from public.request_events where request_id=$1 and to_status='acknowledged'`, [req])).rows[0].c; (c === 1) ? ok("status change auto-appends an event") : bad("status-change event missing"); }
    { const r = await u.rc.c.from("request_events").insert({ request_id: req, hotel_id: H.a, event_type: "internal_note", note: "staff only", is_internal: true });
      (!r.error) ? ok("reception adds internal note event") : bad(`internal note failed: ${r.error?.message}`); }
    { const r = await u.rc.c.from("guest_requests").update({ guest_visible_response: "On the way!" }).eq("id", req);
      await u.rc.c.from("request_events").insert({ request_id: req, hotel_id: H.a, event_type: "guest_reply", note: "On the way!", is_internal: false });
      (!r.error) ? ok("reception sends guest-visible reply") : bad("guest reply failed"); }
    // guest-safe view excludes internal_notes
    { const v = rows(await u.rc.c.from("guest_request_public").select("*").eq("id", req))[0]; (v && !("internal_notes" in v)) ? ok("guest_request_public view excludes internal_notes") : bad("internal_notes present in guest view"); }
    // append-only: cannot UPDATE an event
    { const ev = (await svc.from("request_events").select("id").eq("request_id", req).limit(1).single()).data.id;
      const r = await u.rc.c.from("request_events").update({ note: "tamper" }).eq("id", ev); (r.error) ? ok("request_events are append-only (UPDATE blocked)") : bad("request_events UPDATE allowed"); }
    { await u.rc.c.from("guest_requests").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", req);
      await u.rc.c.from("guest_requests").update({ status: "in_progress" }).eq("id", req);
      const st = (await svc.from("guest_requests").select("status").eq("id", req).single()).data.status; (st === "in_progress") ? ok("resolve then reopen works") : bad("reopen failed"); }
    // editor/marketing cannot manage requests
    { await u.ed.c.from("guest_requests").update({ status: "closed" }).eq("id", req);
      ((await svc.from("guest_requests").select("status").eq("id", req).single()).data.status !== "closed") ? ok("editor cannot manage requests") : bad("editor managed request"); }
    (rows(await u.mk.c.from("guest_requests").select("id").eq("id", req)).length === 0) ? ok("marketing cannot read requests") : bad("marketing read requests");

    // ══ CONSENT: draft/live freeze + sign + immutability + revocation ═══════════
    const V1 = "[synthetic] I consent v1.";
    const tv1 = await ins("consent_templates", { hotel_id: H.a, key: `${P}-gdpr`, locale: "en", version: 1, title: "Consent", body_text: V1, status: "draft" });
    T.v1 = tv1;
    // signing a draft template is rejected
    { const r = await u.rc.c.rpc("sign_consent", { p_template: tv1, p_guest: G.a, p_stay: null, p_signed_name: "Gina" }); (r.error && /published/i.test(r.error.message)) ? ok("cannot sign an unpublished template") : bad("signed a draft template"); }
    // publish v1
    { const r = await u.ha.c.rpc("publish_consent_template", { p_template: tv1, p_change_summary: "v1" }); (!r.error) ? ok("hotel_admin publishes consent template v1") : bad(`publish failed: ${r.error?.message}`); }
    // sign from published v1 → snapshot = V1
    let consent1;
    { const r = await u.rc.c.rpc("sign_consent", { p_template: tv1, p_guest: G.a, p_stay: null, p_signed_name: "Gina Alpha" });
      const c = Array.isArray(r.data) ? r.data[0] : r.data; consent1 = c?.id;
      (!r.error && c?.consent_text_snapshot === V1) ? ok("sign_consent snapshots the exact published text") : bad(`sign failed: ${r.error?.message}`); }
    // FREEZE: editing published template body_text is a no-op (content frozen)
    { await u.ha.c.from("consent_templates").update({ body_text: "TAMPERED" }).eq("id", tv1);
      const b = (await svc.from("consent_templates").select("body_text").eq("id", tv1).single()).data.body_text;
      (b === V1) ? ok("editing a PUBLISHED template's body is frozen (draft/live fix)") : bad(`published template body changed to: ${b}`); }
    // new draft version v2 with new text, publish it
    const V2 = "[synthetic] I consent v2 (updated).";
    const tv2 = await ins("consent_templates", { hotel_id: H.a, key: `${P}-gdpr`, locale: "en", version: 2, title: "Consent", body_text: V2, status: "draft" });
    { const r = await u.ha.c.rpc("publish_consent_template", { p_template: tv2 }); (!r.error) ? ok("publishing v2 promotes a new version") : bad(`publish v2 failed: ${r.error?.message}`); }
    // the FIRST signed consent snapshot is unchanged (immutable, frozen forever)
    { const snap = (await svc.from("consents").select("consent_text_snapshot").eq("id", consent1).single()).data.consent_text_snapshot;
      (snap === V1) ? ok("previously-signed consent snapshot unchanged after v2 publish (immutable)") : bad(`signed snapshot changed: ${snap}`); }
    // signing v2 now stores V2
    { const r = await u.rc.c.rpc("sign_consent", { p_template: tv2, p_guest: G.a, p_stay: null, p_signed_name: "Gina Alpha" });
      const c = Array.isArray(r.data) ? r.data[0] : r.data; (c?.consent_text_snapshot === V2) ? ok("signing v2 stores the v2 text") : bad("v2 sign text wrong"); }
    // immutable: direct UPDATE of a signed consent's text is ignored
    { await u.ha.c.from("consents").update({ consent_text_snapshot: "hack", signed_name: "hack" }).eq("id", consent1);
      const c = (await svc.from("consents").select("consent_text_snapshot,signed_name").eq("id", consent1).single()).data;
      (c.consent_text_snapshot === V1 && c.signed_name === "Gina Alpha") ? ok("signed consent is immutable (edits ignored)") : bad("signed consent edited"); }
    // revoke preserves original
    { const r = await u.rc.c.rpc("revoke_consent", { p_consent: consent1 });
      const c = (await svc.from("consents").select("status,revoked_at,consent_text_snapshot").eq("id", consent1).single()).data;
      (!r.error && c.status === "revoked" && c.revoked_at && c.consent_text_snapshot === V1) ? ok("revocation preserves the original signed snapshot") : bad("revocation wrong"); }
    // editor cannot sign
    { const r = await u.ed.c.rpc("sign_consent", { p_template: tv2, p_guest: G.a, p_stay: null, p_signed_name: "x" }); (r.error && /privilege/i.test(r.error.message)) ? ok("editor cannot record consent") : bad("editor signed consent"); }

    // ══ FEEDBACK ════════════════════════════════════════════════════════════════
    const fb = await ins("feedback", { hotel_id: H.a, room_id: RM.a1, rating: 2, category: "Room", follow_up_requested: true, status: "new" });
    { const r = await u.rc.c.from("feedback").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", fb); (!r.error) ? ok("reception resolves feedback") : bad("feedback resolve failed"); }
    { await u.ed.c.from("feedback").update({ status: "new" }).eq("id", fb);
      ((await svc.from("feedback").select("status").eq("id", fb).single()).data.status === "resolved") ? ok("editor cannot write feedback") : bad("editor wrote feedback"); }
    (rows(await u.mk.c.from("feedback").select("id").eq("id", fb)).length === 0) ? ok("marketing cannot read feedback") : bad("marketing read feedback");

    // ══ CROSS-TENANT isolation ══════════════════════════════════════════════════
    (rows(await u.hb.c.from("guests").select("id").eq("id", G.a)).length === 0) ? ok("cross-tenant: hotel B cannot read hotel A guest") : bad("cross-tenant guest leak");
    (rows(await u.hb.c.from("stays").select("id").eq("id", stayA)).length === 0) ? ok("cross-tenant: hotel B cannot read hotel A stay") : bad("cross-tenant stay leak");
    (rows(await u.hb.c.from("guest_requests").select("id").eq("id", req)).length === 0) ? ok("cross-tenant: hotel B cannot read hotel A request") : bad("cross-tenant request leak");
    (rows(await u.hb.c.from("consents").select("id").eq("id", consent1)).length === 0) ? ok("cross-tenant: hotel B cannot read hotel A consent") : bad("cross-tenant consent leak");
    { const r = await u.hb.c.rpc("pseudonymize_guest", { p_guest: G.a }); (r.error) ? ok("cross-tenant: pseudonymize denied") : bad("cross-tenant pseudonymize allowed"); }
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
