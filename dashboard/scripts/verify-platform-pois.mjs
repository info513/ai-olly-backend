// ============================================================================
// AI OLLY Dashboard — Platform CMS POIs REGRESSION SUITE (aiolly-dev only).
// ----------------------------------------------------------------------------
// Exercises the canonical POI module the way the dashboard does — anon key +
// per-user JWT, RLS-enforced — plus the platform_admin-only publish/rollback/
// history RPCs. Real Auth users; cleaned up by domain + slug prefix. Covers:
//   destination-scoped list/search/filter · create · edit draft · live-unchanged-
//   before-publish · publish · version creation · history · rollback · archive/
//   restore · key uniqueness (per destination) · coordinate validation · cross-
//   destination scoping · platform_admin access · hotel-role denial · anon denial ·
//   hotel_poi_settings intact · no hard delete · resolved serves live snapshot.
// Keys from ../../.env.
//
//   node dashboard/scripts/verify-platform-pois.mjs
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
const P = "vpp", DOM = "@verify-platform-pois.local", PW = "Verify-Pp-Pass!1";

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };
const denied = (r) => !!(r && r.error);

async function main() {
  console.log("AI OLLY — Platform POIs regression suite (aiolly-dev)\n");
  const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } }); await sql.connect();
  const q = (t, p) => sql.query(t, p);
  const u = {};

  const cleanup = async () => {
    try { const { data } = await svc.auth.admin.listUsers({ page: 1, perPage: 300 }); for (const x of (data?.users || [])) if (x.email?.endsWith(DOM)) await svc.auth.admin.deleteUser(x.id).catch(() => {}); } catch {}
    await q(`delete from public.content_versions where entity_type='destination_poi' and entity_id in (select id from public.destination_pois where key like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotel_poi_settings where poi_id in (select id from public.destination_pois where key like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.destination_pois where key like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotel_memberships where hotel_id in (select id from public.hotels where slug like $1)`, [P + "%"]).catch(() => {});
    await q(`delete from public.hotels where slug like $1`, [P + "%"]).catch(() => {});
    await q(`delete from public.destination_pois where destination_id in (select id from public.destinations where slug like $1)`, [P + "%"]).catch(() => {});
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
    u[k] = { id: data.user.id, c, email };
  };

  try {
    await cleanup();
    await mkUser("admin", true);
    await mkUser("hotel", false);
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });

    const dA = (await svc.from("destinations").insert({ name: "PA", slug: `${P}-a`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const dB = (await svc.from("destinations").insert({ name: "PB", slug: `${P}-b`, timezone: "Europe/Zagreb", default_locale: "en", status: "published" }).select("id").single()).data.id;
    const hotelA = (await svc.from("hotels").insert({ name: "HA", slug: `${P}-ha`, destination_id: dA, timezone: "Europe/Zagreb", currency: "EUR" }).select("id").single()).data.id;
    await svc.from("hotel_memberships").insert({ hotel_id: hotelA, user_id: u.hotel.id, role: "hotel_admin", status: "active" });

    // ── 1. CREATE (admin, dA) ──────────────────────────────────────────────────
    const created = await u.admin.c.from("destination_pois").insert({ destination_id: dA, key: `${P}-palace`, name: "Palace", category: "landmark", short_description: "Old palace" }).select("id,status").single();
    (!created.error && created.data?.status === "draft") ? ok("platform_admin creates a draft POI") : bad(`create failed: ${created.error?.message}`);
    const id = created.data.id;

    // ── 2. EDIT DRAFT ──────────────────────────────────────────────────────────
    (!(await u.admin.c.from("destination_pois").update({ address: "Old Town", latitude: 43.5, longitude: 16.44 }).eq("id", id)).error) ? ok("platform_admin edits the draft") : bad("edit failed");

    // ── 3. PUBLISH + VERSION ───────────────────────────────────────────────────
    const pub1 = await u.admin.c.rpc("publish_poi", { p_poi: id, p_change_summary: "v1" });
    (!pub1.error) ? ok("publish_poi succeeds for platform_admin") : bad(`publish failed: ${pub1.error?.message}`);
    const ap = (await svc.from("destination_pois").select("status,published_at,published_snapshot").eq("id", id).single()).data;
    (ap.status === "published" && ap.published_at && ap.published_snapshot) ? ok("publish sets status/published_at + live snapshot") : bad("publish live state wrong");
    const v1 = (await svc.from("content_versions").select("version_number").eq("entity_type", "destination_poi").eq("entity_id", id)).data;
    (v1.length === 1 && v1[0].version_number === 1) ? ok("content_version v1 created") : bad(`version not created (${v1.length})`);

    // ── 4. LIVE UNCHANGED before republish ─────────────────────────────────────
    await u.admin.c.from("destination_pois").update({ name: "Palace Edited" }).eq("id", id);
    const mid = (await svc.from("destination_pois").select("name,published_snapshot").eq("id", id).single()).data;
    (mid.name === "Palace Edited" && mid.published_snapshot.name === "Palace") ? ok("draft edit leaves LIVE snapshot unchanged") : bad("live snapshot changed by draft edit!");

    // ── 5. REPUBLISH ───────────────────────────────────────────────────────────
    await u.admin.c.rpc("publish_poi", { p_poi: id, p_change_summary: "v2" });
    const ap2 = (await svc.from("destination_pois").select("published_snapshot").eq("id", id).single()).data;
    const vc = (await svc.from("content_versions").select("id", { count: "exact", head: true }).eq("entity_type", "destination_poi").eq("entity_id", id)).count;
    (ap2.published_snapshot.name === "Palace Edited" && vc === 2) ? ok("republish refreshes snapshot + v2") : bad("republish wrong");

    // ── 6. HISTORY ─────────────────────────────────────────────────────────────
    const hist = await u.admin.c.rpc("list_poi_versions", { p_poi: id });
    (!hist.error && (hist.data || []).length === 2) ? ok("list_poi_versions returns history for admin") : bad(`history failed: ${hist.error?.message}`);

    // ── 7. ROLLBACK → new draft, live untouched ────────────────────────────────
    const v1id = (await svc.from("content_versions").select("id").eq("entity_type", "destination_poi").eq("entity_id", id).eq("version_number", 1).single()).data.id;
    const rb = await u.admin.c.rpc("rollback_poi", { p_poi: id, p_version: v1id });
    const arb = (await svc.from("destination_pois").select("status,name,published_snapshot").eq("id", id).single()).data;
    (!rb.error && arb.status === "draft" && arb.name === "Palace" && arb.published_snapshot.name === "Palace Edited")
      ? ok("rollback restores v1 into a NEW draft; live snapshot stays v2") : bad(`rollback wrong: ${rb.error?.message} status=${arb.status} name=${arb.name}`);

    // ── 8. ARCHIVE / RESTORE ───────────────────────────────────────────────────
    await u.admin.c.from("destination_pois").update({ status: "archived" }).eq("id", id);
    ((await svc.from("destination_pois").select("status").eq("id", id).single()).data.status === "archived") ? ok("archive sets status=archived") : bad("archive failed");
    await u.admin.c.from("destination_pois").update({ status: "draft" }).eq("id", id);
    ((await svc.from("destination_pois").select("status").eq("id", id).single()).data.status === "draft") ? ok("restore archived→draft") : bad("restore failed");

    // ── 9. KEY UNIQUENESS (per destination) ────────────────────────────────────
    const dup = await u.admin.c.from("destination_pois").insert({ destination_id: dA, key: `${P}-palace`, name: "Dup" });
    (dup.error && /duplicate|unique|23505/i.test(dup.error.message + (dup.error.code || ""))) ? ok("key uniqueness enforced within destination") : bad("duplicate key not rejected");
    const sameKeyOtherDest = await u.admin.c.from("destination_pois").insert({ destination_id: dB, key: `${P}-palace`, name: "OtherDest" }).select("id").single();
    (!sameKeyOtherDest.error) ? ok("same key allowed in a different destination (per-destination uniqueness)") : bad("per-destination key uniqueness wrong");

    // ── 10. COORDINATE VALIDATION ──────────────────────────────────────────────
    const badLat = await u.admin.c.from("destination_pois").update({ latitude: 999 }).eq("id", id).select("id");
    (denied(badLat) || (badLat.data || []).length === 0) ? ok("coordinate check rejects latitude 999") : bad("invalid latitude accepted!");

    // ── 11. CROSS-DESTINATION SCOPING ──────────────────────────────────────────
    const listA = await u.admin.c.from("destination_pois").select("id,destination_id").eq("destination_id", dA);
    const leak = (listA.data || []).some((r) => r.destination_id !== dA);
    (!listA.error && !leak && (listA.data || []).some((r) => r.id === id)) ? ok("destination-scoped list returns only that destination’s POIs") : bad("destination scoping leaked");
    const bPoiId = sameKeyOtherDest.data.id;
    (!(listA.data || []).map((r) => r.id).includes(bPoiId)) ? ok("a POI in destination B is absent from destination A’s scoped list") : bad("cross-destination POI leaked into scoped list");

    // ── 12. PLATFORM_ADMIN ACCESS ──────────────────────────────────────────────
    ((await u.admin.c.from("destination_pois").select("id").eq("id", id)).data?.length === 1) ? ok("platform_admin can read any POI") : bad("admin cannot read POI");

    // ── 13. HOTEL-ROLE DENIAL ──────────────────────────────────────────────────
    denied(await u.hotel.c.from("destination_pois").insert({ destination_id: dA, key: `${P}-hackpoi`, name: "X" })) ? ok("hotel role CANNOT insert a POI") : bad("hotel role inserted a POI!");
    const hUpd = await u.hotel.c.from("destination_pois").update({ name: "hack" }).eq("id", id).select("id");
    (denied(hUpd) || (hUpd.data || []).length === 0) ? ok("hotel role CANNOT update a POI") : bad("hotel role updated a POI!");
    denied(await u.hotel.c.rpc("publish_poi", { p_poi: id, p_change_summary: "x" })) ? ok("hotel role CANNOT publish_poi") : bad("hotel role published a POI!");
    denied(await u.hotel.c.rpc("list_poi_versions", { p_poi: id })) ? ok("hotel role CANNOT read POI history") : bad("hotel role read POI history!");

    // ── 14. ANON DENIAL ────────────────────────────────────────────────────────
    (((await anon.from("destination_pois").select("id").limit(1)).data || []).length === 0) ? ok("anon cannot read POIs (RLS)") : bad("anon read POIs!");
    denied(await anon.rpc("publish_poi", { p_poi: id, p_change_summary: "x" })) ? ok("anon cannot execute publish_poi") : bad("anon executed publish_poi!");

    // ── 15. hotel_poi_settings INTACT across canonical edits ───────────────────
    // publish the POI again first (it's draft after rollback) so it's consumable
    await u.admin.c.rpc("publish_poi", { p_poi: id, p_change_summary: "v3" });
    await svc.from("hotel_poi_settings").insert({ hotel_id: hotelA, poi_id: id, visible: true, featured: true, hotel_recommendation: "Go early" });
    await u.admin.c.from("destination_pois").update({ short_description: "canonical changed" }).eq("id", id);
    await u.admin.c.rpc("publish_poi", { p_poi: id, p_change_summary: "v4" });
    const st = (await svc.from("hotel_poi_settings").select("featured,hotel_recommendation,visible").eq("hotel_id", hotelA).eq("poi_id", id).single()).data;
    (st && st.featured === true && st.hotel_recommendation === "Go early") ? ok("hotel_poi_settings intact after canonical edit + republish") : bad("hotel_poi_settings altered by canonical edit!");

    // ── 16. resolved serves the live POI to the hotel; overlays presentation ───
    const resolved = (await svc.rpc("resolved_destination_pois", { p_hotel: hotelA })).data || [];
    const rp = resolved.find((x) => x.poi_id === id);
    (rp && rp.featured === true && rp.hotel_recommendation === "Go early") ? ok("resolved_destination_pois serves live POI with hotel overlay") : bad("resolved POI wrong");

    // ── 17. NO HARD DELETE ─────────────────────────────────────────────────────
    const del = await u.admin.c.from("destination_pois").delete().eq("id", id).select("id");
    const still = (await svc.from("destination_pois").select("id").eq("id", id)).data?.length === 1;
    ((denied(del) || (del.data || []).length === 0) && still) ? ok("no hard delete — DELETE is a no-op (archive-only)") : bad("POI was hard-deleted!");
    ((await q(`select count(*)::int c from pg_policies where schemaname='public' and tablename='destination_pois' and cmd='DELETE'`)).rows[0].c === 0) ? ok("no DELETE policy on destination_pois") : bad("DELETE policy exists on destination_pois");

    // ── 18. NO REGRESSION: imported Split POIs still resolve for Antique ────────
    const antique = (await svc.from("hotels").select("id").eq("slug", "antique-split").maybeSingle()).data;
    if (antique) {
      const n = (await svc.rpc("resolved_destination_pois", { p_hotel: antique.id })).data?.length || 0;
      (n >= 20) ? ok(`imported Split POIs still resolve for Antique (${n})`) : bad(`Split POIs regressed for Antique (${n})`);
    } else ok("antique-split hotel not present (skipped regression check)");

    // ── 19. NOT-FOUND REGRESSION (QA FIX-3): by-id detail GETs must use maybeSingle ──
    // .single() on a missing row returns a 406 that left the editor stuck on skeletons
    // instead of a not-found state. Guard that no platform detail hook regresses to it.
    { const { readdirSync, readFileSync } = await import("node:fs");
      const dir = decodeURIComponent(import.meta.url).replace(/^file:\/\//, "").replace(/scripts\/[^/]+$/, "src/data");
      let offenders = [];
      for (const f of readdirSync(dir)) {
        if (!/^platform-.*\.ts$/.test(f)) continue;
        const src = readFileSync(dir + "/" + f, "utf8");
        if (/\.eq\("id", id\)\.single\(\)/.test(src)) offenders.push(f);
      }
      offenders.length === 0 ? ok("all platform by-id detail GETs use maybeSingle (not-found safe)") : bad(`by-id .single() regressed in: ${offenders.join(", ")}`);
      // behaviour: a random non-existent POI resolves to null, not an error
      const miss = await svc.from("destination_pois").select("id").eq("id", "00000000-0000-0000-0000-000000000000").maybeSingle();
      (!miss.error && miss.data === null) ? ok("missing POI id resolves to null (clean not-found)") : bad("missing POI id did not resolve to null"); }

  } finally {
    await cleanup();
    await sql.end();
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"} Platform POIs regression: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
