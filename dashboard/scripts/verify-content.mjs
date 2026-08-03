// ============================================================================
// AI OLLY Dashboard — Content module REGRESSION SUITE (aiolly-dev only).
// ----------------------------------------------------------------------------
// Exercises the Content module the way the dashboard does — anon key + per-user
// JWT, RLS-enforced — across roles and tenants. Real Auth users; cleaned up.
// Covers rooms inheritance/overrides, service resolution, the Draft/Live
// separation (Sprint 3.1), publish/rollback/versions/critical-ack, permissions,
// and cross-tenant denial. Reads the service-role key from ../../.env at runtime.
//
//   node dashboard/scripts/verify-content.mjs
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
const P = "vc", DOM = "@verify.local", PW = "Verify-Content-Pass!1";
const BODY = (t) => ({ version: 1, blocks: [{ type: "paragraph", text: t }] });
const snapOf = (o) => ({ title: o.title, key: o.key, source_type: o.source_type ?? "hotel", active: true, is_critical: !!o.is_critical, visible_in_pwa: o.visible_in_pwa ?? true, visible_in_web: o.visible_in_web ?? false, available_to_ai: o.available_to_ai ?? true, sort_order: o.sort_order ?? 0, category_id: o.category_id, override_of_service_id: o.override_of_service_id ?? null, body_content: o.body_content, valid_from: null, valid_to: null, published_at: new Date().toISOString() });

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };
const denied = (r) => !!(r && r.error);
const rows = (r) => (r && r.data) ? r.data : [];
const ids = [];

async function main() {
  console.log("AI OLLY — Content regression suite (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();
  const q = (t, p) => sql.query(t, p);
  const u = {}, H = {}, RT = {}, RM = {}, C = {}, S = {};

  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    if (ids.length) { await q(`delete from public.content_versions where entity_id = any($1::uuid[])`, [ids]).catch(() => {}); }
    await q(`delete from public.audit_log where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotel_services where key like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.service_categories where key like $1`, [P + "%"]).catch(() => {});
    const hsub = `(select id from public.hotels where slug like $1)`;
    await q(`delete from public.rooms where hotel_id in ${hsub}`, [P + "%"]).catch(() => {});
    await q(`delete from public.room_types where hotel_id in ${hsub}`, [P + "%"]).catch(() => {});
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
  const ins = async (t, r) => { const x = await svc.from(t).insert(r).select("id").single(); if (x.error) throw new Error(`${t}: ${x.error.message}`); ids.push(x.data.id); return x.data.id; };
  const resolvedRoom = async (client, rid) => (rows(await client.from("resolved_rooms").select("*").eq("room_id", rid)))[0];
  const resolvedSvc = async (client, hotel) => rows(await client.rpc("resolved_hotel_services", { p_hotel: hotel }));

  try {
    await cleanup();

    // ── fixtures ──────────────────────────────────────────────────────────────
    const dA = await ins("destinations", { name: "DA", slug: `${P}-da`, timezone: "Europe/Zagreb" });
    const dB = await ins("destinations", { name: "DB", slug: `${P}-db`, timezone: "Europe/Zagreb" });
    H.a = await ins("hotels", { name: "HA", slug: `${P}-ha`, destination_id: dA, timezone: "Europe/Zagreb", currency: "EUR" });
    H.b = await ins("hotels", { name: "HB", slug: `${P}-hb`, destination_id: dB, timezone: "Europe/Zagreb", currency: "EUR" });
    RT.a = await ins("room_types", { hotel_id: H.a, name: "Deluxe", slug: `${P}-dlx`, smart_glass: true, underfloor_heating: true, default_capacity: 2, default_bed_configuration: "King" });
    RM.inherit = await ins("rooms", { hotel_id: H.a, room_type_id: RT.a, room_number: "101", access_token: `${P}-t1` });
    RM.gTrue = await ins("rooms", { hotel_id: H.a, room_type_id: RT.a, room_number: "102", access_token: `${P}-t2`, smart_glass_override: true });
    RM.gFalse = await ins("rooms", { hotel_id: H.a, room_type_id: RT.a, room_number: "103", access_token: `${P}-t3`, smart_glass_override: false });
    C.plat = await ins("service_categories", { hotel_id: null, key: `${P}-pcat`, name: "P" });
    C.a = await ins("service_categories", { hotel_id: H.a, key: `${P}-hcat`, name: "H" });
    S.plat = await ins("hotel_services", { hotel_id: null, category_id: C.plat, key: `${P}-checkin`, title: "Check-in", body_content: BODY("PLATFORM 15:00"), status: "published", is_critical: true, published_at: new Date().toISOString(), published_snapshot: snapOf({ title: "Check-in", key: `${P}-checkin`, source_type: "platform", is_critical: true, category_id: C.plat, body_content: BODY("PLATFORM 15:00") }) });
    S.override = await ins("hotel_services", { hotel_id: H.a, category_id: C.plat, key: `${P}-checkin`, title: "Check-in HA", body_content: BODY("OVERRIDE 14:00"), status: "published", is_critical: true, override_of_service_id: S.plat, published_at: new Date().toISOString(), last_critical_ack_at: new Date().toISOString(), published_snapshot: snapOf({ title: "Check-in HA", key: `${P}-checkin`, source_type: "override", is_critical: true, category_id: C.plat, override_of_service_id: S.plat, body_content: BODY("OVERRIDE 14:00") }) });
    S.draft = await ins("hotel_services", { hotel_id: H.a, category_id: C.a, key: `${P}-draft`, title: "Draft Svc", body_content: BODY("draft"), status: "draft" });
    S.crit = await ins("hotel_services", { hotel_id: H.a, category_id: C.a, key: `${P}-crit`, title: "Critical Svc", body_content: BODY("critical"), status: "draft", is_critical: true });
    S.pub = await ins("hotel_services", { hotel_id: H.a, category_id: C.a, key: `${P}-pub`, title: "Publish Target", body_content: BODY("bodyA"), status: "draft" });

    await mkUser("ha"); await mkUser("ed"); await mkUser("rc"); await mkUser("ro"); await mkUser("hb");
    await svc.from("hotel_memberships").insert([
      { hotel_id: H.a, user_id: u.ha.id, role: "hotel_admin", status: "active" },
      { hotel_id: H.a, user_id: u.ed.id, role: "editor", status: "active" },
      { hotel_id: H.a, user_id: u.rc.id, role: "reception", status: "active" },
      { hotel_id: H.a, user_id: u.ro.id, role: "read_only", status: "active" },
      { hotel_id: H.b, user_id: u.hb.id, role: "hotel_admin", status: "active" },
    ]);
    ok("fixtures + users created");

    // ══ ROOMS ══════════════════════════════════════════════════════════════════
    { const r = await resolvedRoom(u.ha.c, RM.inherit); (r?.smart_glass === true && r?.capacity === 2) ? ok("room inherits room-type defaults (smart_glass true, capacity 2)") : bad(`inherit wrong: ${JSON.stringify(r)}`); }
    { const r = await resolvedRoom(u.ha.c, RM.gTrue); (r?.smart_glass === true) ? ok("room override=true resolves true") : bad("override true wrong"); }
    { const r = await resolvedRoom(u.ha.c, RM.gFalse); (r?.smart_glass === false) ? ok("room override=false resolves false (preserved, not empty)") : bad(`override false wrong: ${r?.smart_glass}`); }
    // remove override -> back to inherited
    await u.ha.c.from("rooms").update({ smart_glass_override: null }).eq("id", RM.gFalse);
    { const r = await resolvedRoom(u.ha.c, RM.gFalse); (r?.smart_glass === true) ? ok("removing override reverts to inherited (true)") : bad("remove override wrong"); }
    // editor may edit content override; reception/read_only cannot write
    await u.ed.c.from("rooms").update({ view_description_override: "ED view" }).eq("id", RM.inherit);
    ((await svc.from("rooms").select("view_description_override").eq("id", RM.inherit).single()).data.view_description_override === "ED view") ? ok("editor edits room content override") : bad("editor room edit failed");
    await u.rc.c.from("rooms").update({ view_description_override: "RC" }).eq("id", RM.inherit);
    ((await svc.from("rooms").select("view_description_override").eq("id", RM.inherit).single()).data.view_description_override !== "RC") ? ok("reception cannot write rooms") : bad("reception wrote room");
    await u.ro.c.from("rooms").update({ view_description_override: "RO" }).eq("id", RM.inherit);
    ((await svc.from("rooms").select("view_description_override").eq("id", RM.inherit).single()).data.view_description_override !== "RO") ? ok("read_only cannot write rooms") : bad("read_only wrote room");
    denied(await u.ha.c.from("rooms").select("access_token").limit(1)) ? ok("access_token never selectable (even hotel_admin)") : bad("access_token leaked");

    // ══ SERVICES: resolution ════════════════════════════════════════════════════
    { const R = await resolvedSvc(u.ha.c, H.a); const idset = R.map((x) => x.service_id);
      (idset.includes(S.override) && !idset.includes(S.plat)) ? ok("service override wins; platform default excluded (no duplicate)") : bad("override/dedup wrong");
      (new Set(idset).size === idset.length) ? ok("no duplicate resolved services") : bad("duplicate resolved");
      (!idset.includes(S.draft)) ? ok("draft excluded from resolved live") : bad("draft leaked to resolved"); }

    // ══ SERVICES: publish / version / history ═══════════════════════════════════
    { const r = await u.ed.c.rpc("publish_hotel_service", { p_service: S.pub, p_change_summary: "v1" });
      const v = (await q(`select count(*)::int c from public.content_versions where entity_type='hotel_service' and entity_id=$1`, [S.pub])).rows[0].c;
      (!r.error && v === 1) ? ok("editor publish creates immutable version (v1)") : bad(`publish/version wrong: ${r.error?.message}`); }
    { const R = await resolvedSvc(u.ha.c, H.a); R.some((x) => x.service_id === S.pub) ? ok("published service now appears in resolved") : bad("published not resolved"); }
    { const h = await u.ha.c.rpc("list_service_versions", { p_service: S.pub }); (!h.error && (h.data ?? []).length === 1) ? ok("history readable (list_service_versions)") : bad(`history wrong: ${h.error?.message}`); }

    // ══ SERVICES: critical acknowledgement ══════════════════════════════════════
    { const r = await u.ha.c.rpc("publish_hotel_service", { p_service: S.crit }); (r.error && /critical/i.test(r.error.message)) ? ok("critical publish without ack rejected") : bad("critical no-ack allowed"); }
    { const r = await u.ha.c.rpc("publish_hotel_service", { p_service: S.crit, p_acknowledge_critical: true }); (!r.error) ? ok("critical publish with ack succeeds") : bad(`critical ack failed: ${r.error?.message}`); }
    { const r = await u.ed.c.rpc("publish_hotel_service", { p_service: S.crit }); (r.error && /critical/i.test(r.error.message)) ? ok("editor cannot bypass critical acknowledgement") : bad("editor bypassed critical"); }

    // ══ DRAFT / LIVE separation (Sprint 3.1 core) ══════════════════════════════
    const liveBody = async () => (await resolvedSvc(u.ha.c, H.a)).find((x) => x.service_id === S.pub)?.body_content?.blocks?.[0]?.text;
    (await liveBody()) === "bodyA" ? ok("live service shows published content (bodyA)") : bad("live content wrong pre-edit");
    await u.ha.c.from("hotel_services").update({ body_content: BODY("bodyB DRAFT") }).eq("id", S.pub);      // draft save
    (await liveBody()) === "bodyA" ? ok("DRAFT SAVE does not change live (guests still see bodyA)") : bad("draft edit leaked to guests");
    await u.ha.c.rpc("publish_hotel_service", { p_service: S.pub, p_change_summary: "v2 bodyB" });            // publish
    (await liveBody()) === "bodyB DRAFT" ? ok("PUBLISH promotes draft to live (guests see bodyB)") : bad("publish did not promote");
    { const v = (await q(`select count(*)::int c from public.content_versions where entity_type='hotel_service' and entity_id=$1`, [S.pub])).rows[0].c; (v === 2) ? ok("second publish created v2 (append-only history)") : bad(`version count wrong: ${v}`); }
    // rollback to v1 -> new DRAFT; live STILL bodyB; publish -> live bodyA restored
    { const v1 = (await q(`select id from public.content_versions where entity_type='hotel_service' and entity_id=$1 and version_number=1`, [S.pub])).rows[0].id;
      const r = await u.ha.c.rpc("rollback_hotel_service", { p_service: S.pub, p_version: v1 });
      const st = (await svc.from("hotel_services").select("status").eq("id", S.pub).single()).data.status;
      (!r.error && st === "draft") ? ok("rollback restores into a NEW draft (status=draft)") : bad(`rollback wrong: ${r.error?.message} status=${st}`);
      (await liveBody()) === "bodyB DRAFT" ? ok("after rollback guests STILL see last published (bodyB)") : bad("rollback leaked to guests");
      await u.ha.c.rpc("publish_hotel_service", { p_service: S.pub, p_change_summary: "publish rollback" });
      (await liveBody()) === "bodyA" ? ok("publishing the rollback restores bodyA for guests") : bad("rollback publish wrong");
      const v = (await q(`select count(*)::int c from public.content_versions where entity_type='hotel_service' and entity_id=$1`, [S.pub])).rows[0].c;
      (v === 3) ? ok("history is append-only (v3; v1/v2 never overwritten)") : bad(`history overwritten: ${v}`); }

    // ══ PERMISSIONS ═════════════════════════════════════════════════════════════
    // editor edits hotel service content but not is_critical (admin-only)
    await u.ed.c.from("hotel_services").update({ short_description: "ED", is_critical: true }).eq("id", S.pub);
    { const r = (await svc.from("hotel_services").select("short_description,is_critical").eq("id", S.pub).single()).data; (r.short_description === "ED" && r.is_critical === false) ? ok("editor edits content but cannot toggle is_critical") : bad(`editor is_critical wrong: ${JSON.stringify(r)}`); }
    // hotel users cannot edit platform default
    await u.ha.c.from("hotel_services").update({ title: "HACK" }).eq("id", S.plat);
    ((await svc.from("hotel_services").select("title").eq("id", S.plat).single()).data.title === "Check-in") ? ok("hotel_admin cannot edit platform default") : bad("platform default edited");
    { const r = await u.ha.c.rpc("publish_hotel_service", { p_service: S.plat, p_acknowledge_critical: true }); (r.error && /privilege/i.test(r.error.message)) ? ok("hotel_admin cannot publish platform default") : bad("hotel_admin published platform default"); }
    // reception/read_only can READ published, cannot write
    (rows(await u.rc.c.from("hotel_services").select("id").eq("id", S.override)).length === 1) ? ok("reception reads published services") : bad("reception cannot read published");
    (rows(await u.ro.c.from("hotel_services").select("id").eq("id", S.draft)).length === 0) ? ok("read_only cannot see drafts") : bad("read_only saw draft");
    await u.rc.c.from("hotel_services").update({ title: "RC" }).eq("id", S.pub);
    ((await svc.from("hotel_services").select("title").eq("id", S.pub).single()).data.title !== "RC") ? ok("reception cannot author services") : bad("reception authored service");

    // ══ CROSS-TENANT denial ════════════════════════════════════════════════════
    (rows(await u.hb.c.from("hotel_services").select("id").eq("id", S.pub)).length === 0) ? ok("cross-tenant: hotel B admin cannot read hotel A service") : bad("cross-tenant service leak");
    (rows(await u.hb.c.from("rooms").select("id").eq("id", RM.inherit)).length === 0) ? ok("cross-tenant: hotel B admin cannot read hotel A room") : bad("cross-tenant room leak");
    { const r = await u.hb.c.rpc("list_service_versions", { p_service: S.pub }); (r.error && /privilege/i.test(r.error.message)) ? ok("cross-tenant: history denied") : bad("cross-tenant history leak"); }
    { const R = await resolvedSvc(u.hb.c, H.a); (R.filter((x) => x.service_id === S.pub).length === 0) ? ok("cross-tenant: resolved for hotel A hides A's hotel service from B admin") : bad("cross-tenant resolved leak"); }
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
