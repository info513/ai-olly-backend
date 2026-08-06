// ============================================================================
// AI OLLY Dashboard — Platform CMS Routes REGRESSION SUITE (aiolly-dev only).
// ----------------------------------------------------------------------------
// Exercises the canonical Routes module (incl. ordered POI waypoints) the way the
// dashboard does — anon key + per-user JWT, RLS-enforced — plus the platform_admin
// publish/rollback/history RPCs. Real Auth users; cleaned up by domain + slug
// prefix. Covers: destination-scoped list/search/filter · create · edit draft ·
// live-unchanged-before-publish · publish · version creation · history · rollback ·
// archive/restore · key uniqueness · valid difficulty/distance/duration · add/
// remove/reorder waypoints · waypoint order persists · order in published snapshot ·
// rollback restores waypoint order · cross-destination POI assignment denied ·
// platform_admin access · hotel-role denial · anon denial · hotel_route_settings
// intact · resolved routes available · archived excluded · no hard delete.
// Keys from ../../.env.
//
//   node dashboard/scripts/verify-platform-routes.mjs
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
const P = "vpr", DOM = "@verify-platform-routes.local", PW = "Verify-Pr-Pass!1";

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };
const denied = (r) => !!(r && r.error);
const wp = (...stops) => ({ version: 1, stops });

async function main() {
  console.log("AI OLLY — Platform Routes regression suite (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();
  const q = (t, p) => sql.query(t, p);
  const u = {};

  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await q(`delete from public.content_versions where entity_type='destination_route' and entity_id in (select id from public.destination_routes where key like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotel_route_settings where route_id in (select id from public.destination_routes where key like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.destination_routes where key like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotel_memberships where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.destination_pois where destination_id in (select id from public.destinations where slug like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.destination_routes where destination_id in (select id from public.destinations where slug like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.destinations where slug like $1`, [P + "%"]).catch(() => {});
  };
  const mkUser = async (k, admin = false) => {
    const email = `${P}.${k}${DOM}`;
    const { data, error } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true });
    if (error) throw new Error(`createUser ${k}: ${error.message}`);
    await svc.from("profiles").insert({ user_id: data.user.id, email, is_platform_admin: admin });
    const c = createClient(URL, ANON, { auth: { persistSession: false } });
    const s = await c.auth.signInWithPassword({ email, password: PW });
    if (s.error) throw new Error(`signin ${k}: ${s.error.message}`);
    u[k] = { id: data.user.id, c };
  };
  const mkPoi = async (dest, key) => (await svc.from("destination_pois").insert({ destination_id: dest, key, name: key, status: "published" }).select("id,key").single()).data;

  try {
    await cleanup();
    await mkUser("admin", true);
    await mkUser("hotel", false);
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });

    const dA = (await svc.from("destinations").insert({ name: "RA", slug: `${P}-a`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const dB = (await svc.from("destinations").insert({ name: "RB", slug: `${P}-b`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const a1 = await mkPoi(dA, `${P}-a1`), a2 = await mkPoi(dA, `${P}-a2`), a3 = await mkPoi(dA, `${P}-a3`);
    const b1 = await mkPoi(dB, `${P}-b1`);
    const hotelA = (await svc.from("hotels").insert({ name: "HA", slug: `${P}-ha`, destination_id: dA, timezone: "Europe/Zagreb", currency: "EUR" }).select("id").single()).data.id;
    await svc.from("hotel_memberships").insert({ hotel_id: hotelA, user_id: u.hotel.id, role: "hotel_admin", status: "active" });
    const stop = (p) => ({ poi_id: p.id, poi_key: p.key, note: null });

    // ── 1. CREATE with waypoints ───────────────────────────────────────────────
    const created = await u.admin.c.from("destination_routes").insert({ destination_id: dA, key: `${P}-loop`, name: "Loop", route_type: "walking", difficulty: "easy", distance_km: 2.5, duration_minutes: 60, waypoints: wp(stop(a1), stop(a2)) }).select("id,status,waypoints").single();
    (!created.error && created.data?.status === "draft") ? ok("platform_admin creates a draft route") : bad(`create failed: ${created.error?.message}`);
    const id = created.data.id;
    (created.data.waypoints?.stops?.length === 2 && created.data.waypoints.stops[0].poi_id === a1.id) ? ok("waypoints stored as ordered stops on create") : bad("waypoints not stored");

    // ── 2. valid difficulty/distance/duration ──────────────────────────────────
    const badDist = await u.admin.c.from("destination_routes").update({ distance_km: -5 }).eq("id", id).select("id");
    (denied(badDist) || (badDist.data || []).length === 0) ? ok("negative distance rejected (CHECK)") : bad("negative distance accepted!");
    (!(await u.admin.c.from("destination_routes").update({ difficulty: "moderate", distance_km: 3, duration_minutes: 90 }).eq("id", id)).error) ? ok("valid difficulty/distance/duration accepted") : bad("valid values rejected");

    // ── 3. add / reorder / remove waypoints; order persists ────────────────────
    await u.admin.c.from("destination_routes").update({ waypoints: wp(stop(a1), stop(a2), stop(a3)) }).eq("id", id);
    ((await svc.from("destination_routes").select("waypoints").eq("id", id).single()).data.waypoints.stops.length === 3) ? ok("add waypoint → 3 stops") : bad("add waypoint failed");
    await u.admin.c.from("destination_routes").update({ waypoints: wp(stop(a3), stop(a1), stop(a2)) }).eq("id", id);
    { const s = (await svc.from("destination_routes").select("waypoints").eq("id", id).single()).data.waypoints.stops.map((x) => x.poi_id);
      (s[0] === a3.id && s[1] === a1.id && s[2] === a2.id) ? ok("reorder waypoints → order persists") : bad(`reorder wrong: ${JSON.stringify(s)}`); }
    await u.admin.c.from("destination_routes").update({ waypoints: wp(stop(a3), stop(a1)) }).eq("id", id);
    ((await svc.from("destination_routes").select("waypoints").eq("id", id).single()).data.waypoints.stops.length === 2) ? ok("remove waypoint → 2 stops") : bad("remove waypoint failed");

    // ── 4. cross-destination POI assignment denied ─────────────────────────────
    const xdest = await u.admin.c.from("destination_routes").update({ waypoints: wp(stop(a1), stop(b1)) }).eq("id", id).select("id");
    (denied(xdest) || (xdest.data || []).length === 0) ? ok("cross-destination POI waypoint denied (trigger)") : bad("cross-destination POI accepted!");
    // ensure the route still has its valid 2 stops (the bad update was rejected)
    await u.admin.c.from("destination_routes").update({ waypoints: wp(stop(a1), stop(a2), stop(a3)) }).eq("id", id);

    // ── 5. PUBLISH → snapshot includes ordered waypoints ───────────────────────
    const pub1 = await u.admin.c.rpc("publish_route", { p_route: id, p_change_summary: "v1" });
    (!pub1.error) ? ok("publish_route succeeds for platform_admin") : bad(`publish failed: ${pub1.error?.message}`);
    const ap = (await svc.from("destination_routes").select("status,published_snapshot").eq("id", id).single()).data;
    (ap.status === "published" && ap.published_snapshot?.waypoints?.stops?.length === 3) ? ok("published snapshot includes ordered waypoints (3 stops)") : bad("snapshot waypoints wrong");
    const v1 = (await svc.from("content_versions").select("version_number,snapshot").eq("entity_type", "destination_route").eq("entity_id", id)).data;
    (v1.length === 1 && v1[0].snapshot?.waypoints?.stops?.length === 3) ? ok("content_version v1 created with waypoint order") : bad("version/waypoints wrong");

    // ── 6. LIVE UNCHANGED: reorder draft waypoints; snapshot order unchanged ────
    const snapOrder = ap.published_snapshot.waypoints.stops.map((s) => s.poi_id);
    await u.admin.c.from("destination_routes").update({ name: "Loop Edited", waypoints: wp(stop(a2), stop(a1)) }).eq("id", id);
    const mid = (await svc.from("destination_routes").select("name,waypoints,published_snapshot").eq("id", id).single()).data;
    const liveOrder = mid.published_snapshot.waypoints.stops.map((s) => s.poi_id);
    (mid.name === "Loop Edited" && JSON.stringify(liveOrder) === JSON.stringify(snapOrder) && mid.waypoints.stops.length === 2)
      ? ok("draft waypoint/name edits leave LIVE snapshot (order) unchanged") : bad("live snapshot changed by draft edit!");

    // ── 7. REPUBLISH + HISTORY ─────────────────────────────────────────────────
    await u.admin.c.rpc("publish_route", { p_route: id, p_change_summary: "v2" });
    const hist = await u.admin.c.rpc("list_route_versions", { p_route: id });
    (!hist.error && (hist.data || []).length === 2) ? ok("list_route_versions returns history for admin") : bad(`history failed: ${hist.error?.message}`);

    // ── 8. ROLLBACK restores waypoint ordering into draft ──────────────────────
    const v1id = (await svc.from("content_versions").select("id").eq("entity_type", "destination_route").eq("entity_id", id).eq("version_number", 1).single()).data.id;
    const rb = await u.admin.c.rpc("rollback_route", { p_route: id, p_version: v1id });
    const arb = (await svc.from("destination_routes").select("status,name,waypoints,published_snapshot").eq("id", id).single()).data;
    const rbOrder = arb.waypoints.stops.map((s) => s.poi_id);
    (!rb.error && arb.status === "draft" && arb.name === "Loop" && JSON.stringify(rbOrder) === JSON.stringify(snapOrder))
      ? ok("rollback restores v1 waypoint order into a NEW draft") : bad(`rollback wrong: status=${arb.status} order=${JSON.stringify(rbOrder)}`);
    // live snapshot (v2) still holds the 2-stop order, unaffected by rollback
    (arb.published_snapshot.waypoints.stops.length === 2) ? ok("rollback leaves live snapshot (v2) unchanged") : bad("rollback changed live snapshot!");

    // ── 9. ARCHIVE / RESTORE ───────────────────────────────────────────────────
    await u.admin.c.from("destination_routes").update({ status: "archived" }).eq("id", id);
    ((await svc.from("destination_routes").select("status").eq("id", id).single()).data.status === "archived") ? ok("archive sets status=archived") : bad("archive failed");
    await u.admin.c.from("destination_routes").update({ status: "draft" }).eq("id", id);
    ((await svc.from("destination_routes").select("status").eq("id", id).single()).data.status === "draft") ? ok("restore archived→draft") : bad("restore failed");

    // ── 10. KEY UNIQUENESS + LIST/FILTER/SEARCH + SCOPING ──────────────────────
    const dup = await u.admin.c.from("destination_routes").insert({ destination_id: dA, key: `${P}-loop`, name: "Dup" });
    (dup.error && /duplicate|unique|23505/i.test(dup.error.message + (dup.error.code || ""))) ? ok("key uniqueness enforced within destination") : bad("duplicate key not rejected");
    const listA = await u.admin.c.from("destination_routes").select("id,destination_id").eq("destination_id", dA);
    (!listA.error && (listA.data || []).every((r) => r.destination_id === dA) && (listA.data || []).some((r) => r.id === id)) ? ok("destination-scoped list returns only that destination’s routes") : bad("scoping leaked");
    const search = await u.admin.c.from("destination_routes").select("id").ilike("key", `${P}-loop`);
    (!search.error && search.data.length === 1) ? ok("search (key ilike) works") : bad("search failed");

    // publish again so it's consumable for resolved / settings tests
    await u.admin.c.rpc("publish_route", { p_route: id, p_change_summary: "v3" });

    // ── 11. HOTEL-ROLE + ANON DENIAL ───────────────────────────────────────────
    denied(await u.hotel.c.from("destination_routes").insert({ destination_id: dA, key: `${P}-hack`, name: "X" })) ? ok("hotel role CANNOT insert a route") : bad("hotel role inserted a route!");
    const hUpd = await u.hotel.c.from("destination_routes").update({ name: "hack" }).eq("id", id).select("id");
    (denied(hUpd) || (hUpd.data || []).length === 0) ? ok("hotel role CANNOT update a route") : bad("hotel role updated a route!");
    denied(await u.hotel.c.rpc("publish_route", { p_route: id, p_change_summary: "x" })) ? ok("hotel role CANNOT publish_route") : bad("hotel role published a route!");
    denied(await u.hotel.c.rpc("list_route_versions", { p_route: id })) ? ok("hotel role CANNOT read route history") : bad("hotel role read route history!");
    (((await anon.from("destination_routes").select("id").limit(1)).data || []).length === 0) ? ok("anon cannot read routes (RLS)") : bad("anon read routes!");
    denied(await anon.rpc("publish_route", { p_route: id, p_change_summary: "x" })) ? ok("anon cannot execute publish_route") : bad("anon executed publish_route!");

    // ── 12. hotel_route_settings INTACT across canonical edits ─────────────────
    await svc.from("hotel_route_settings").insert({ hotel_id: hotelA, route_id: id, visible: true, featured: true, hotel_recommendation: "Great walk" });
    await u.admin.c.from("destination_routes").update({ short_description: "canonical changed" }).eq("id", id);
    await u.admin.c.rpc("publish_route", { p_route: id, p_change_summary: "v4" });
    const st = (await svc.from("hotel_route_settings").select("featured,hotel_recommendation").eq("hotel_id", hotelA).eq("route_id", id).single()).data;
    (st && st.featured === true && st.hotel_recommendation === "Great walk") ? ok("hotel_route_settings intact after canonical edit + republish") : bad("hotel_route_settings altered!");

    // ── 13. resolved routes available; archived excluded ───────────────────────
    { const R = (await svc.rpc("resolved_destination_routes", { p_hotel: hotelA })).data || [];
      const r = R.find((x) => x.route_id === id);
      (r && r.featured === true && r.waypoints?.stops) ? ok("resolved_destination_routes serves published route w/ waypoints + overlay") : bad("resolved route wrong"); }
    await u.admin.c.from("destination_routes").update({ status: "archived" }).eq("id", id);
    { const R = (await svc.rpc("resolved_destination_routes", { p_hotel: hotelA })).data || [];
      (!R.map((x) => x.route_id).includes(id)) ? ok("archived route excluded from resolved") : bad("archived route still resolved!"); }
    await u.admin.c.from("destination_routes").update({ status: "draft" }).eq("id", id);

    // ── 14. NO HARD DELETE ─────────────────────────────────────────────────────
    const del = await u.admin.c.from("destination_routes").delete().eq("id", id).select("id");
    const still = (await svc.from("destination_routes").select("id").eq("id", id)).data?.length === 1;
    ((denied(del) || (del.data || []).length === 0) && still) ? ok("no hard delete — DELETE is a no-op (archive-only)") : bad("route was hard-deleted!");
    ((await q(`select count(*)::int c from pg_policies where schemaname='public' and tablename='destination_routes' and cmd='DELETE'`)).rows[0].c === 0) ? ok("no DELETE policy on destination_routes") : bad("DELETE policy exists");

    // ── 15. NO REGRESSION: imported Split routes still resolve for Antique ──────
    const antique = (await svc.from("hotels").select("id").eq("slug", "antique-split").maybeSingle()).data;
    if (antique) {
      const n = (await svc.rpc("resolved_destination_routes", { p_hotel: antique.id })).data?.length || 0;
      (n >= 1) ? ok(`imported Split routes still resolve for Antique (${n})`) : bad(`Split routes regressed for Antique (${n})`);
    } else ok("antique-split hotel not present (skipped regression check)");

  } finally {
    await cleanup();
    await sql.end();
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"} Platform Routes regression: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
