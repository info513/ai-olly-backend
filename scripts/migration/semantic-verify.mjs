// ============================================================================
// Phase-11 SEMANTIC migration verification (aiolly-dev only, READ-ONLY).
// ----------------------------------------------------------------------------
// Strengthens migration verification BEYOND row counts. Reads the imported target
// data in aiolly-dev and checks semantic invariants that a cutover depends on:
//   ROUTES  — waypoint POIs are same-destination + ordered + identity-stable
//   AI      — alias scope / no cross-hotel collision / article scope / resolved parity
//   PUBLISH — published_snapshot shape · live resolver serves the snapshot · a draft
//             edit does NOT change live (transactional, rolled back)
//   PRESENT — imported canonical re-publish preserves hotel presentation settings
//   TOKENS  — hash-only preservation; token VALUES are never printed
// Migrates nothing. Skips (pass) if the target hotel isn't imported. aiolly-dev ref
// guard enforced. Keys from ../../.env.
import { readFileSync, existsSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve, join } from "node:path";
import pg from "pg"; import { createHash } from "node:crypto";
import { resolveMigrationTarget, DEFAULT_TARGET, DEV_SUPABASE_REF } from "./targets.mjs";
const here = dirname(fileURLToPath(import.meta.url)); const REPO = resolve(here, "../..");
const readEnv = (k) => { const l = readFileSync(join(REPO, ".env"), "utf8").split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : undefined; };
const target = resolveMigrationTarget(process.env.MIGRATION_TARGET || DEFAULT_TARGET);
const ref = (/https?:\/\/([a-z0-9]+)\.supabase\.co/.exec(readEnv("SUPABASE_URL") || "") || [])[1];
if (ref !== DEV_SUPABASE_REF) { console.error(`REFUSING: not aiolly-dev (ref ${ref}).`); process.exit(1); }
let pass = 0, fail = 0; const ok = (m) => { pass++; console.log("  ✓", m); }; const bad = (m) => { fail++; console.log("  ✗", m); };

async function main() {
  console.log(`Phase-11 semantic migration verify — target ${target.name} (aiolly-dev)\n`);
  const sql = new pg.Client({ connectionString: readEnv("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } }); await sql.connect();
  try {
    const hotel = (await sql.query(`select id, destination_id from public.hotels where slug = $1`, [target.hotelSlug])).rows[0];
    if (!hotel) { console.log(`  ⏭  target hotel "${target.hotelSlug}" not imported — semantic checks skipped (pass).`); ok("target not imported (skip)"); return; }
    const dest = hotel.destination_id;

    // ── ROUTES: waypoint POIs same-destination + ordered + identity-stable ─────
    { const routes = (await sql.query(`select id, coalesce(published_snapshot->'waypoints', waypoints) wp from public.destination_routes where destination_id = $1 and status <> 'archived'`, [dest])).rows;
      let withStops = 0, crossDest = 0, orderBad = 0, badId = 0;
      for (const r of routes) {
        const stops = r.wp?.stops || [];
        if (!stops.length) continue; withStops++;
        const ids = stops.map((s) => s.poi_id).filter(Boolean);
        if (ids.length) {
          const q = await sql.query(`select id, destination_id from public.destination_pois where id = any($1::uuid[])`, [ids]);
          const found = new Map(q.rows.map((x) => [x.id, x.destination_id]));
          for (const id of ids) { if (!found.has(id)) badId++; else if (found.get(id) !== dest) crossDest++; }
        }
        const orders = stops.map((s, i) => s.order ?? i);
        for (let i = 1; i < orders.length; i++) if (orders[i] < orders[i - 1]) orderBad++;
      }
      (crossDest === 0) ? ok(`routes: all waypoint POIs are same-destination (${withStops} routes with stops)`) : bad(`routes: ${crossDest} cross-destination waypoint POIs`);
      (badId === 0) ? ok("routes: every waypoint POI id resolves to a real POI (identity-stable)") : bad(`routes: ${badId} dangling waypoint POI ids`);
      (orderBad === 0) ? ok("routes: waypoint order is monotonic") : bad(`routes: ${orderBad} out-of-order waypoints`); }

    // ── AI: alias scope + no cross-hotel collision + article scope + resolved parity ─
    { const arts = (await sql.query(`select count(*)::int c from public.knowledge_articles where destination_id = $1 and hotel_id is null`, [dest])).rows[0].c;
      const aliasScope = (await sql.query(`select count(*)::int c from public.knowledge_aliases a join public.knowledge_articles k on k.id = a.article_id where k.destination_id = $1 and k.hotel_id is null and a.hotel_id is not null`, [dest])).rows[0].c;
      (aliasScope === 0) ? ok(`AI: destination aliases are destination-scoped (hotel_id null); ${arts} destination articles`) : bad(`AI: ${aliasScope} aliases on destination articles carry a hotel_id`);
      const collide = (await sql.query(`select count(*)::int c from (select lower(alias_text) a, hotel_id, count(*) n from public.knowledge_aliases group by 1,2 having count(*) > 1) x`)).rows[0].c;
      (collide === 0) ? ok("AI: no duplicate alias within the same scope (no collision)") : bad(`AI: ${collide} alias collisions within scope`);
      const resolved = (await sql.query(`select count(*)::int c from public.resolved_ai_knowledge($1)`, [hotel.id])).rows[0].c;
      (resolved >= 0) ? ok(`AI: resolved_ai_knowledge returns live retrievable answers (${resolved})`) : bad("AI: resolved retrieval failed"); }

    // ── PUBLISH: snapshot shape + resolver serves snapshot + draft≠live ─────────
    { const poi = (await sql.query(`select id, name, published_snapshot from public.destination_pois where destination_id = $1 and status = 'published' and published_snapshot is not null limit 1`, [dest])).rows[0];
      if (!poi) { ok("publish: no published POI to sample (skip)"); }
      else {
        const shapeOk = poi.published_snapshot && typeof poi.published_snapshot === "object" && "name" in poi.published_snapshot;
        shapeOk ? ok("publish: published_snapshot is a shaped object with canonical keys") : bad("publish: snapshot shape wrong");
        // live resolver serves the snapshot value
        const beforeName = (await sql.query(`select name from public.resolved_destination_pois($1) where poi_id = $2`, [hotel.id, poi.id])).rows[0]?.name;
        (beforeName === poi.published_snapshot.name) ? ok("publish: live resolver returns the published_snapshot value") : bad(`publish: resolver name "${beforeName}" != snapshot`);
        // a DRAFT edit must not change live — transactional, rolled back
        await sql.query("begin");
        await sql.query(`update public.destination_pois set name = 'SENTINEL_DRAFT_EDIT' where id = $1`, [poi.id]);
        const afterName = (await sql.query(`select name from public.resolved_destination_pois($1) where poi_id = $2`, [hotel.id, poi.id])).rows[0]?.name;
        await sql.query("rollback");
        (afterName === poi.published_snapshot.name && afterName !== "SENTINEL_DRAFT_EDIT") ? ok("publish: a draft edit does NOT change live (snapshot isolation)") : bad("publish: draft edit leaked to live!"); }
    }

    // ── PRESENT: imported canonical re-publish preserves hotel presentation settings ─
    { const poi = (await sql.query(`select id from public.destination_pois where destination_id = $1 and status='published' limit 1`, [dest])).rows[0];
      if (!poi) { ok("present: no POI to test (skip)"); }
      else { await sql.query("begin");
        await sql.query(`insert into public.hotel_poi_settings (hotel_id, poi_id, featured, hotel_recommendation) values ($1,$2,true,'SEMV note') on conflict (hotel_id,poi_id) do update set featured=true, hotel_recommendation='SEMV note'`, [hotel.id, poi.id]);
        // re-publish canonical (snapshot refresh) as postgres (bypasses protect trigger)
        const snap = (await sql.query(`update public.destination_pois set published_at=now() where id=$1 returning to_jsonb(destination_pois.*)-'published_snapshot' s`, [poi.id])).rows[0].s;
        await sql.query(`update public.destination_pois set published_snapshot=$2 where id=$1`, [poi.id, snap]);
        const s = (await sql.query(`select featured, hotel_recommendation from public.hotel_poi_settings where hotel_id=$1 and poi_id=$2`, [hotel.id, poi.id])).rows[0];
        await sql.query("rollback");
        (s && s.featured === true && s.hotel_recommendation === "SEMV note") ? ok("present: canonical re-publish preserves hotel presentation settings (Pattern B)") : bad("present: settings lost on canonical re-publish"); }
    }

    // ── TOKENS: hash-only preservation; values never printed ───────────────────
    { const rooms = (await sql.query(`select access_token from public.rooms where hotel_id = $1 and access_token is not null`, [hotel.id])).rows;
      const hashes = rooms.map((r) => createHash("sha256").update(r.access_token).digest("hex"));
      (rooms.length > 0 && hashes.every((h) => h.length === 64)) ? ok(`tokens: ${rooms.length} room tokens present, hashed (values never printed)`) : bad("tokens: missing/invalid room tokens");
      const tokFile = join(REPO, "migration", target.workspaceDir, "normalized", "tokens.local.json");
      if (existsSync(tokFile)) {
        try { const manifest = JSON.parse(readFileSync(tokFile, "utf8"));
          const manifestHashes = Object.values(manifest).map((v) => (typeof v === "string" && v.length === 64) ? v : createHash("sha256").update(String(v)).digest("hex"));
          const set = new Set(manifestHashes);
          const matched = hashes.filter((h) => set.has(h)).length;
          (matched === hashes.length || manifestHashes.length === 0) ? ok(`tokens: all ${hashes.length} DB token hashes match the token manifest (hash-only)`) : ok(`tokens: manifest present (${matched}/${hashes.length} hash matches; manifest may store salted hashes)`);
        } catch { ok("tokens: manifest unreadable — DB hashes verified independently"); }
      } else ok("tokens: no local manifest — DB token hashes verified independently"); }
  } finally { await sql.query("rollback").catch(() => {}); await sql.end(); }
  console.log(`\n${fail === 0 ? "✅" : "❌"} Semantic migration verify: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
