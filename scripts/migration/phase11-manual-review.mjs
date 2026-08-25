// ============================================================================
// phase11-manual-review.mjs — Phase 11 manual-review cleanup (DEV-ONLY, idempotent).
// ----------------------------------------------------------------------------
//   node scripts/migration/phase11-manual-review.mjs
//
// Closes the owner-actionable manual-review items with source-backed data only:
//
//  1) VAT — owner confirmed ALL Antique Split prices are VAT-INCLUSIVE. Sets
//     price_items.vat_included = TRUE for every Antique price. The vat_rate column
//     is NOT NULL in the schema, so its existing 0.00 stays as a schema-forced
//     placeholder meaning "rate unconfirmed" — it is NOT a claim of 0% VAT and no
//     tax rate is fabricated.
//
//  2) Split destination coordinates — 43.5100, 16.4400 (Wikipedia — Split, Croatia).
//
//  3) The 4 canonically-added POIs get verified coordinates + address + provenance:
//       Grgur Ninski   43.5094324, 16.4407936  (OpenStreetMap; Ul. kralja Tomislava, by the Golden Gate)
//       Sv. Frane      43.5082220, 16.4355160  (Trg Franje Tuđmana 1, western Riva)
//       Palace Walls   43.50833,   16.44000    (Wikipedia — Diocletian's Palace)
//       Streets        43.50833,   16.44000    (Wikipedia — Diocletian's Palace)
//     (Precision matches the source; no invented precision.) All four are re-published.
//
//  4) Route durations — keep only source-exact values from each route's own title
//     (60 min, 90 min, 2 h=120 min); ranges/open-ended ("1–2 h", "2–3 h", "2 h+")
//     are set to NULL (unknown) rather than kept as a mis-parsed placeholder.
//     distance_km stays NULL (genuinely unknown). Routes re-published.
//
// Not touched here (intentionally): media licences (marked pending until real images
// are uploaded), Antique's 1/6 route visibility (the hotel's Pattern-B choice).
// Refuses any non-aiolly-dev target. No production, no tokens, no fabricated facts.
import { readFileSync } from "node:fs"; import pg from "pg";
const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const readEnv = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
if (!readEnv("SUPABASE_URL").includes("mcgrccvvybgcozeqlisj")) { console.error("REFUSING: not aiolly-dev."); process.exit(1); }
const SPLIT = "2cd0ab85-b9a7-4fd1-875c-94d57fe2ab5e";
const ANTIQUE = "4a8e6860-068f-4412-b226-18942f63223c";
const sql = new pg.Client({ connectionString: readEnv("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });
await sql.connect();
const q = (s, p = []) => sql.query(s, p);
const republishPoi = (key) => q(`update destination_pois set status='published', published_at=now(), published_snapshot = to_jsonb(destination_pois.*)-'published_snapshot' where destination_id=$1 and key=$2`, [SPLIT, key]);
const republishRoute = (key) => q(`update destination_routes set status='published', published_at=now(), published_snapshot = to_jsonb(destination_routes.*)-'published_snapshot' where destination_id=$1 and key=$2`, [SPLIT, key]);

// 1) VAT inclusive (owner-confirmed); vat_rate placeholder untouched (NOT NULL, rate unconfirmed).
await q(`update price_items set vat_included=true where hotel_id=$1`, [ANTIQUE]);

// 2) Split destination coordinates + provenance + verified.
await q(`update destinations set latitude=43.5100, longitude=16.4400,
  source_name='Wikipedia — Split, Croatia', source_url='https://en.wikipedia.org/wiki/Split,_Croatia',
  verification_status='verified', last_verified_at=now() where id=$1`, [SPLIT]);

// 3) Verified coordinates for the 4 canonical POIs.
const POIS = [
  { key: "grgur-ninski", lat: 43.5094324, lng: 16.4407936, addr: "Ul. kralja Tomislava, 21000 Split", sn: "OpenStreetMap (Nominatim)", su: "https://www.openstreetmap.org/#map=19/43.50943/16.44079" },
  { key: "church-of-st-francis-sv-frane", lat: 43.5082220, lng: 16.4355160, addr: "Trg Franje Tuđmana 1, 21000 Split", sn: "OpenStreetMap / VisitSplit", su: "https://www.openstreetmap.org/#map=19/43.50822/16.43552" },
  { key: "palace-walls-zidine", lat: 43.50833, lng: 16.44000, addr: "Diocletian's Palace, 21000 Split", sn: "Wikipedia — Diocletian's Palace", su: "https://en.wikipedia.org/wiki/Diocletian%27s_Palace" },
  { key: "streets-of-diocletians-palace-ulice", lat: 43.50833, lng: 16.44000, addr: "Diocletian's Palace, 21000 Split", sn: "Wikipedia — Diocletian's Palace", su: "https://en.wikipedia.org/wiki/Diocletian%27s_Palace" },
];
for (const p of POIS) {
  await q(`update destination_pois set latitude=$2, longitude=$3, address=$4, source_name=$5, source_url=$6, verification_status='verified', last_verified_at=now(), updated_at=now() where destination_id=$1 and key=$7`, [SPLIT, p.lat, p.lng, p.addr, p.sn, p.su, p.key]);
  await republishPoi(p.key);
}

// 4) Route durations — source-exact kept, ranges nulled; distance stays null.
const ROUTES = [
  ["romantic-split-12-h", null], ["inside-the-palace-60-min", 60], ["relax-green-split-23-h", null],
  ["local-taste-traditions-2-h", 120], ["history-heritage-2-h", null], ["split-by-night-90-min", 90],
];
for (const [key, dur] of ROUTES) { await q(`update destination_routes set duration_minutes=$2, updated_at=now() where destination_id=$1 and key=$3`, [SPLIT, dur, key]); await republishRoute(key); }

const poiCoords = (await q(`select count(*) filter(where latitude is not null and longitude is not null)::int c, count(*)::int t from destination_pois where destination_id=$1`, [SPLIT])).rows[0];
const vat = (await q(`select count(*) filter(where vat_included)::int incl, count(*)::int t from price_items where hotel_id=$1`, [ANTIQUE])).rows[0];
console.log(`Manual-review cleanup done (idempotent):`);
console.log(`  VAT inclusive: ${vat.incl}/${vat.t} (rate = NOT-NULL placeholder 0.00, unconfirmed)`);
console.log(`  Split POIs with coordinates: ${poiCoords.c}/${poiCoords.t}`);
console.log(`  Split destination + 4 POIs: verified, provenance recorded; route placeholders removed.`);
await sql.end();
