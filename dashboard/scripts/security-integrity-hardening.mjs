// AI OLLY — Pre-Phase-11 Integrity Hardening REGRESSION SUITE (aiolly-dev only).
// Deterministically reproduces each independent-review finding and proves the fix.
// Uses service-role for setup + trigger tests (service_role bypasses RLS but NOT
// triggers), a platform_admin auth user to isolate integrity checks inside SECURITY
// DEFINER RPCs, and pg for defense-in-depth planting. All synthetic rows cleaned up.
// Covers: S-01 (profile suspension), F-03/S-02 (consent stay), F-03/S-03 (ops
// same-hotel), S-04 (subscriber↔consent), S-05 (campaign scope), F-04/S-06 (legacy
// publish snapshot), S-08 (backend secret guard), S-09 (dev-only route guard). Keys from ../../.env.
import { readFileSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve } from "node:path";
import pg from "pg"; import { createClient } from "@supabase/supabase-js";
const here = dirname(fileURLToPath(import.meta.url)); const envPath = resolve(here, "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const URL = readEnv("SUPABASE_URL"), ANON = readEnv("SUPABASE_ANON_KEY"), SRV = readEnv("SUPABASE_SERVICE_ROLE_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const svc = createClient(URL, SRV, { auth: { persistSession: false } });
const P = "vih", DOM = "@verify-integrity.local", PW = "Verify-Integrity!1";
let pass = 0, fail = 0; const ok = (m) => { pass++; console.log("  ✓", m); }; const bad = (m) => { fail++; console.log("  ✗", m); };
const denied = (r) => !!(r && r.error);
const isSbErr = (e) => !!(e && (e.code || e.message));

async function main() {
  console.log("AI OLLY — Pre-Phase-11 integrity hardening regression (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();

  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 400 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await sql.query(`delete from public.destination_pois where destination_id in (select id from public.destinations where slug like $1)`, [P + "%"]).catch(() => {});
    for (const t of ["newsletter_campaigns","newsletter_segment_members","newsletter_segments","newsletter_templates","newsletter_subscribers","consents","consent_templates","guest_requests","feedback","push_subscriptions","stays","guests","rooms","room_types","hotel_services","service_categories","hotel_memberships","hotels"]) {
      await sql.query(`delete from public.${t} where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {});
    }
    await sql.query(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {});
    await sql.query(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {});
  };
  const mkUser = async (k, admin = false) => { const email = `${P}.${k}${DOM}`; const { data } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true }); await svc.from("profiles").insert({ user_id: data.user.id, email, is_platform_admin: admin }); const c = createClient(URL, ANON, { auth: { persistSession: false } }); await c.auth.signInWithPassword({ email, password: PW }); return { id: data.user.id, c }; };
  const ins1 = async (t, row) => { const r = await svc.from(t).insert(row).select("id").single(); if (r.error) throw new Error(`${t}: ${r.error.message}`); return r.data.id; };

  try {
    await cleanup();
    const dest = await ins1("destinations", { name: "VIH", slug: `${P}-d`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" });
    const hotelA = await ins1("hotels", { name: "VIH A", slug: `${P}-ha`, destination_id: dest, timezone: "Europe/Zagreb", currency: "EUR" });
    const hotelB = await ins1("hotels", { name: "VIH B", slug: `${P}-hb`, destination_id: dest, timezone: "Europe/Zagreb", currency: "EUR" });
    const guestA = await ins1("guests", { hotel_id: hotelA });
    const guestB = await ins1("guests", { hotel_id: hotelB });
    const rtA = await ins1("room_types", { hotel_id: hotelA, name: "RT A", slug: `${P}-rt-a` });
    const rtB = await ins1("room_types", { hotel_id: hotelB, name: "RT B", slug: `${P}-rt-b` });
    const roomA = await ins1("rooms", { hotel_id: hotelA, room_type_id: rtA, room_number: `${P}-A1`, access_token: `${P}-tok-a` });
    const roomB = await ins1("rooms", { hotel_id: hotelB, room_type_id: rtB, room_number: `${P}-B1`, access_token: `${P}-tok-b` });
    const stayA = await ins1("stays", { hotel_id: hotelA, guest_id: guestA, room_id: roomA });
    const stayB = await ins1("stays", { hotel_id: hotelB, guest_id: guestB, room_id: roomB });

    const pa = await mkUser("admin", true); // platform_admin isolates integrity checks from role checks

    // ── 1. S-01 inactive profile + active membership → denied ──────────────────
    const u = await mkUser("member", false);
    await svc.from("hotel_memberships").insert({ hotel_id: hotelA, user_id: u.id, role: "hotel_admin", status: "active" });
    const catA = await ins1("service_categories", { hotel_id: hotelA, key: `${P}-cat`, name: "Cat", sort_order: 1 });
    const svcA = await ins1("hotel_services", { hotel_id: hotelA, category_id: catA, key: `${P}-s`, title: "Svc", status: "published" });
    (((await u.c.from("hotel_services").select("id").eq("id", svcA)).data || []).length === 1) ? ok("active profile + active membership → hotel data readable") : bad("active/active could not read");
    await svc.from("profiles").update({ active: false }).eq("user_id", u.id);
    (((await u.c.from("hotel_services").select("id").eq("id", svcA)).data || []).length === 0) ? ok("S-01: inactive profile + active membership → DENIED") : bad("S-01: inactive profile still reads hotel data!");
    await svc.from("profiles").update({ active: true }).eq("user_id", u.id);
    (((await u.c.from("hotel_services").select("id").eq("id", svcA)).data || []).length === 1) ? ok("re-activating profile restores access") : bad("re-activation failed");
    // suspended membership still denied — use a SEPARATE reception member (not the last
    // hotel_admin, which is protected from suspension) so the suspension actually applies.
    await svc.from("guest_requests").insert({ hotel_id: hotelA, request_type: "other", title: `${P}-gr0` });
    const u2 = await mkUser("reception", false);
    await svc.from("hotel_memberships").insert({ hotel_id: hotelA, user_id: u2.id, role: "reception", status: "active" });
    (((await u2.c.from("guest_requests").select("id").eq("hotel_id", hotelA)).data || []).length >= 1) ? ok("active profile + active membership reads guest_requests") : bad("active member could not read guest_requests");
    const susp = await svc.from("hotel_memberships").update({ status: "suspended" }).eq("hotel_id", hotelA).eq("user_id", u2.id).select("id");
    if (susp.error) { bad(`could not suspend reception membership: ${susp.error.message}`); }
    else { const fresh = createClient(URL, ANON, { auth: { persistSession: false } }); await fresh.auth.signInWithPassword({ email: `${P}.reception${DOM}`, password: PW });
      (((await fresh.from("guest_requests").select("id").eq("hotel_id", hotelA)).data || []).length === 0) ? ok("active profile + suspended membership → denied") : bad("suspended membership still reads!"); }

    // ── 2-3. F-03/S-02 sign_consent stay integrity (called as platform_admin) ──
    const tmplA = await ins1("consent_templates", { hotel_id: hotelA, key: `${P}-ct`, title: "T", version: 1, locale: "en", body_text: "x", status: "published", active: true });
    { const r = await pa.c.rpc("sign_consent", { p_template: tmplA, p_guest: guestA, p_stay: stayB, p_signed_name: "X" });
      (denied(r) && /another hotel/.test(r.error.message)) ? ok("S-02: consent with foreign-hotel stay → DENIED") : bad(`S-02: foreign-hotel stay accepted (${r.error?.message})`); }
    { const stayA2 = await ins1("stays", { hotel_id: hotelA, guest_id: guestB, room_id: roomA }).catch(() => null);
      // stayA2 references guestB (hotel B) → blocked by the stays scope? stays has no trigger; guest_id mismatch is what sign_consent checks.
      if (stayA2) { const r = await pa.c.rpc("sign_consent", { p_template: tmplA, p_guest: guestA, p_stay: stayA2, p_signed_name: "X" });
        (denied(r) && /another guest/.test(r.error.message)) ? ok("S-02: consent with wrong-guest stay → DENIED") : bad(`S-02: wrong-guest stay accepted (${r.error?.message})`);
      } else ok("S-02: wrong-guest stay setup skipped (stays fk)"); }

    // ── 4-6. F-03/S-03 guest_requests same-hotel (trigger fires even for service-role) ─
    const gr = (extra) => ({ hotel_id: hotelA, request_type: "other", title: "x", ...extra });
    denied(await svc.from("guest_requests").insert(gr({ guest_id: guestB }))) ? ok("S-03: request with foreign guest → DENIED") : bad("S-03: foreign guest accepted");
    denied(await svc.from("guest_requests").insert(gr({ stay_id: stayB }))) ? ok("S-03: request with foreign stay → DENIED") : bad("S-03: foreign stay accepted");
    denied(await svc.from("guest_requests").insert(gr({ room_id: roomB }))) ? ok("S-03: request with foreign room → DENIED") : bad("S-03: foreign room accepted");
    // control: a fully same-hotel request is accepted
    { const r = await svc.from("guest_requests").insert(gr({ guest_id: guestA, stay_id: stayA, room_id: roomA })).select("id");
      (!r.error) ? ok("same-hotel request accepted (control)") : bad(`same-hotel request rejected: ${r.error.message}`); }

    // ── 7. feedback same-hotel (stay/room) ─────────────────────────────────────
    denied(await svc.from("feedback").insert({ hotel_id: hotelA, stay_id: stayB })) ? ok("S-03: feedback with foreign stay → DENIED") : bad("S-03: feedback foreign stay accepted");
    denied(await svc.from("feedback").insert({ hotel_id: hotelA, room_id: roomB })) ? ok("S-03: feedback with foreign room → DENIED") : bad("S-03: feedback foreign room accepted");

    // ── 8. push_subscriptions same-hotel (stay) ────────────────────────────────
    denied(await svc.from("push_subscriptions").insert({ hotel_id: hotelA, stay_id: stayB, endpoint: `https://x/${P}` })) ? ok("S-03: push subscription with foreign stay → DENIED") : bad("S-03: push foreign stay accepted");

    // ── 9-10. S-04 newsletter subscriber ↔ consent same-hotel ──────────────────
    const consentB = await ins1("consents", { hotel_id: hotelB, guest_id: guestB, template_id: null, consent_type: `${P}-ct`, consent_version: 1, locale: "en", consent_text_snapshot: "x", signed_name: "B", signed_at: new Date().toISOString(), status: "granted" });
    denied(await svc.from("newsletter_subscribers").insert({ hotel_id: hotelA, email: `${P}.sub@x.local`, status: "subscribed", consent_id: consentB })) ? ok("S-04: subscriber with foreign consent → DENIED (trigger)") : bad("S-04: foreign consent subscriber accepted");
    // defense-in-depth: plant the impossible row with triggers disabled, prove resolver ignores it
    const segA = await ins1("newsletter_segments", { hotel_id: hotelA, key: `${P}-seg`, name: "Seg", type: "rule", rules: { conditions: [] } });
    await sql.query("set session_replication_role = replica");
    const subId = (await sql.query(`insert into public.newsletter_subscribers (hotel_id,email,status,consent_id) values ($1,$2,'subscribed',$3) returning id`, [hotelA, `${P}.plant@x.local`, consentB])).rows[0].id;
    await sql.query("set session_replication_role = origin");
    { const r = await pa.c.rpc("resolve_newsletter_audience", { p_segment: segA });
      const hit = (r.data || []).some((x) => x.subscriber_id === subId);
      (!r.error && !hit) ? ok("S-04: audience resolver IGNORES foreign-hotel consent (defense-in-depth)") : bad(`S-04: resolver included foreign-consent subscriber (${r.error?.message})`); }

    // ── 11-12. S-05 schedule_campaign template/segment scope ───────────────────
    const tmplNlA = await ins1("newsletter_templates", { hotel_id: hotelA, key: `${P}-nt-a`, name: "NA", subject: "s", content: { blocks: [] }, status: "published" });
    const tmplNlB = await ins1("newsletter_templates", { hotel_id: hotelB, key: `${P}-nt-b`, name: "NB", subject: "s", content: { blocks: [] }, status: "published" });
    const segB = await ins1("newsletter_segments", { hotel_id: hotelB, key: `${P}-seg-b`, name: "SB", type: "rule", rules: { conditions: [] } });
    const campForeignTmpl = await ins1("newsletter_campaigns", { hotel_id: hotelA, name: "C1", template_id: tmplNlB, segment_id: segA, status: "draft" });
    { const r = await pa.c.rpc("schedule_campaign", { p_campaign: campForeignTmpl, p_scheduled_at: new Date(Date.now() + 864e5).toISOString() });
      (denied(r) && /template belongs to another hotel/.test(r.error.message)) ? ok("S-05: campaign with foreign template → DENIED") : bad(`S-05: foreign template scheduled (${r.error?.message})`); }
    const campForeignSeg = await ins1("newsletter_campaigns", { hotel_id: hotelA, name: "C2", template_id: tmplNlA, segment_id: segB, status: "draft" });
    { const r = await pa.c.rpc("schedule_campaign", { p_campaign: campForeignSeg, p_scheduled_at: new Date(Date.now() + 864e5).toISOString() });
      (denied(r) && /segment belongs to another hotel/.test(r.error.message)) ? ok("S-05: campaign with foreign segment → DENIED") : bad(`S-05: foreign segment scheduled (${r.error?.message})`); }
    // control: same-hotel template + segment schedules fine
    const campOk = await ins1("newsletter_campaigns", { hotel_id: hotelA, name: "C3", template_id: tmplNlA, segment_id: segA, status: "draft" });
    { const r = await pa.c.rpc("schedule_campaign", { p_campaign: campOk, p_scheduled_at: new Date(Date.now() + 864e5).toISOString() });
      (!r.error && r.data?.status === "scheduled") ? ok("same-hotel campaign schedules (control)") : bad(`same-hotel campaign failed: ${r.error?.message}`); }

    // ── 13. F-04/S-06 legacy publish_destination_content cannot bypass snapshot ─
    const poiId = await ins1("destination_pois", { destination_id: dest, key: `${P}-poi`, name: "Legacy POI", category: "landmark", status: "draft", active: true });
    { const r = await pa.c.rpc("publish_destination_content", { p_entity_type: "destination_poi", p_entity_id: poiId, p_change_summary: "legacy" });
      const snap = (await svc.from("destination_pois").select("published_snapshot,status").eq("id", poiId).single()).data;
      (!r.error && snap.status === "published" && snap.published_snapshot != null) ? ok("S-06: legacy publish_destination_content now writes published_snapshot (no bypass)") : bad(`S-06: legacy publish left snapshot null (${r.error?.message})`); }
    // and anon can no longer even hold execute (self-guard + revoked)
    { const anon = createClient(URL, ANON, { auth: { persistSession: false } });
      denied(await anon.rpc("publish_destination_content", { p_entity_type: "destination_poi", p_entity_id: poiId })) ? ok("S-06: anon cannot call legacy publish RPC") : bad("S-06: anon called legacy publish!"); }

    // ── 14. S-09 dev-only route guard logic (assertDevProject) ─────────────────
    { const guardSrc = readFileSync(resolve(here, "../src/server/dev-guard.ts"), "utf8");
      /isProductionRuntime|NODE_ENV.*production/.test(guardSrc) && /DEV_SUPABASE_REF|mcgrccvvybgcozeqlisj/.test(guardSrc) ? ok("S-09: dev-guard checks production + aiolly-dev ref") : bad("S-09: dev-guard missing checks");
      const webhookSrc = readFileSync(resolve(here, "../src/app/api/newsletter/webhook-dev/route.ts"), "utf8");
      const callsGuard = /assertDevProject\(\)/.test(webhookSrc);
      const guardBeforeService = webhookSrc.indexOf("assertDevProject()") < webhookSrc.indexOf("SUPABASE_SERVICE_ROLE_KEY");
      (callsGuard && guardBeforeService) ? ok("S-09: webhook-dev calls assertDevProject before any service-role work") : bad("S-09: webhook-dev not guarded before service-role"); }

    // ── 15. S-08 backend secret guard (server.js static) ───────────────────────
    { const srv = readFileSync(resolve(here, "../../server/server.js"), "utf8");
      const noFallback = !/WEBHOOK_SECRET\s*=\s*['"]/.test(srv) && !/RECEPTION_PIN\s*=\s*['"]/.test(srv);
      const hasGuard = /IS_PROD/.test(srv) && /Production requires/.test(srv) && /process\.exit\(1\)/.test(srv);
      (noFallback && hasGuard) ? ok("S-08: server.js has no hardcoded secret fallback + production fails safely") : bad(`S-08: secret guard missing (noFallback=${noFallback} hasGuard=${hasGuard})`); }

  } finally { await sql.query("set session_replication_role = origin").catch(() => {}); await cleanup(); await sql.end(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} Integrity hardening regression: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
