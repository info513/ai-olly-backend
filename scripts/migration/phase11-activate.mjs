// ============================================================================
// phase11-activate.mjs — Split/Antique activation completions (DEV-ONLY, idempotent).
// ----------------------------------------------------------------------------
//   node scripts/migration/phase11-activate.mjs
//
// Two safe, source-preserving completions surfaced during Phase 11 verification:
//
//  1) Antique Hotel Presentation (Pattern B) — ensure every canonical Split POI has
//     a hotel_poi_settings row for Antique (the 4 canonically-added POIs — Grgur
//     Ninski, Sv. Frane, Palace Walls, Streets — were missing one). Added visible.
//
//  2) Hotel service published_snapshot repair — the Antique import stored each
//     service's published_snapshot as only its body_content ({blocks,version})
//     instead of the full-row snapshot the resolver reads (snap->>'title', etc.),
//     so resolved_hotel_services() returned empty titles. Regenerate published
//     services' snapshots as the full row (matches the POI/knowledge convention).
//     No content is changed — only the snapshot shape is corrected.
//
// Refuses any non-aiolly-dev target. No production, no Airtable, no tokens printed.
import { readFileSync } from "node:fs"; import pg from "pg";
const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const readEnv = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const SB = readEnv("SUPABASE_URL");
if (!SB.includes("mcgrccvvybgcozeqlisj")) { console.error(`REFUSING: not aiolly-dev (${SB}).`); process.exit(1); }
const SPLIT = "2cd0ab85-b9a7-4fd1-875c-94d57fe2ab5e";
const ANTIQUE = "4a8e6860-068f-4412-b226-18942f63223c";

const sql = new pg.Client({ connectionString: readEnv("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });
await sql.connect();
const q = async (s, p = []) => (await sql.query(s, p)).rows;

// 1) Pattern-B POI presentation coverage
const addedPoi = await q(
  `insert into hotel_poi_settings (hotel_id, poi_id, visible, featured)
   select $2, p.id, true, false from destination_pois p
   where p.destination_id = $1
     and not exists (select 1 from hotel_poi_settings s where s.hotel_id = $2 and s.poi_id = p.id)
   returning poi_id`, [SPLIT, ANTIQUE]);
const poiCov = (await q(
  `select (select count(*) from destination_pois where destination_id=$1)::int total,
          (select count(*) from hotel_poi_settings where hotel_id=$2)::int settings`, [SPLIT, ANTIQUE]))[0];
console.log(`Pattern-B POI settings: +${addedPoi.length} added → ${poiCov.settings}/${poiCov.total} Split POIs covered for Antique`);

// 2) Service snapshot repair (full-row) for published services missing a snapshot title
const fixed = await q(
  `update hotel_services set published_snapshot = to_jsonb(hotel_services.*) - 'published_snapshot'
   where hotel_id = $1 and status = 'published' and (published_snapshot->>'title') is null
   returning id`, [ANTIQUE]);
const svc = (await q(
  `select count(*) filter (where title is not null)::int titled, count(*)::int total from resolved_hotel_services($1)`, [ANTIQUE]))[0];
console.log(`Service snapshots repaired: ${fixed.length}; resolved_hotel_services now ${svc.titled}/${svc.total} titled`);

console.log("Phase 11 activation completions done (idempotent).");
await sql.end();
