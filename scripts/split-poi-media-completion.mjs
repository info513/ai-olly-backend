// ============================================================================
// AI OLLY — Split POI + PWA Media completion (DEV-ONLY, aiolly-dev).
// ----------------------------------------------------------------------------
// Completes the canonical Split visual/content layer in the Platform CMS:
//   • uploads the supplied processed images as DESTINATION-owned Split media
//     (POIs + destination hero + destination module heroes) and Antique-Split
//     HOTEL-owned media (hotel module heroes) via the existing assets pipeline;
//   • assigns each POI's canonical_asset_id and re-publishes (snapshot refresh);
//   • creates the 4 genuinely-missing canonical POIs (Grgur Ninski, Sv. Frane,
//     Palace Walls, Streets) with a safe factual minimum — NO invented coords
//     (flagged for manual review), NO invented hours/prices/accessibility;
//   • records destination/hotel hero usages via asset_usages.
// Idempotent (keyed by metadata.src_file / poi key / usage unique). No production,
// no DATA_PROVIDER change, no Airtable, no PII, no guest-PWA cutover. Keys from ../.env.
import { readFileSync, existsSync, readdirSync } from "node:fs"; import { basename, join } from "node:path";
import pg from "pg"; import { createClient } from "@supabase/supabase-js";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const readEnv = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const SB_URL = readEnv("SUPABASE_URL"), SRV = readEnv("SUPABASE_SERVICE_ROLE_KEY"), DBURL = readEnv("SUPABASE_DB_URL");
const DEV_REF = "mcgrccvvybgcozeqlisj";
if (!SB_URL.includes(DEV_REF)) { console.error(`REFUSING: not aiolly-dev (${SB_URL}).`); process.exit(1); }
const svc = createClient(SB_URL, SRV, { auth: { persistSession: false } });
const sql = new pg.Client({ connectionString: DBURL, ssl: { rejectUnauthorized: false } });

const SPLIT = "2cd0ab85-b9a7-4fd1-875c-94d57fe2ab5e";
const ANTIQUE = "4a8e6860-068f-4412-b226-18942f63223c";
// The 31 processed originals were copied verbatim (via bash, which resolves the
// Croatian "đ"/NFD folder name that Node's readdirSync cannot see through macOS
// TCC) to an ASCII scratchpad path. Filenames are preserved exactly.
const SRC = "/private/tmp/claude-501/-Users-ivansimic-Downloads/0777afb8-d2b8-43e2-9d47-f6556e409e63/scratchpad/split-src";
if (!existsSync(SRC)) { console.error(`Processed-image folder not found: ${SRC}`); process.exit(1); }
const CREDIT = "Pressmax processed image set (AI OLLY)";
const LICENSE_PENDING = "license metadata pending";

// ── POI images → existing canonical key, or {create} for the 4 missing ────────
const POI_IMAGES = [
  { file: "riva.jpg", key: "the-riva-waterfront", alt: "Split's Riva waterfront promenade with palms and the palace facade", destHero: true },
  { file: "zlatna_vrata.jpg", key: "the-golden-gate", alt: "The Golden Gate (Zlatna vrata) of Diocletian's Palace" },
  { file: "krstionica.jpg", key: "temple-of-jupiter-baptistery", alt: "The Baptistery (Temple of Jupiter) with the black sphinx" },
  { file: "peristil.jpg", key: "peristyle-peristil", alt: "The Peristyle (Peristil) courtyard of Diocletian's Palace" },
  { file: "pjaca.jpg", key: "pjaca-peoples-square", alt: "Pjaca — People's Square with the old town hall" },
  { file: "srebrena_vrata.jpg", key: "the-silver-gate", alt: "The Silver Gate (Srebrena vrata) of Diocletian's Palace" },
  { file: "sv_duje.jpg", key: "cathedral-of-saint-domnius", alt: "The Cathedral of St Domnius (Sv. Duje) bell tower" },
  { file: "trg_brace_radic.jpg", key: "vocni-trg-fruit-square", alt: "Trg braće Radić (Voćni trg / Fruit Square) with the Marulić statue" },
  { file: "vestibul.jpg", key: "vestibule", alt: "The Vestibule dome with its open oculus" },
  { file: "sustipan.jpg", key: "sustipan-park", alt: "Sustipan park with cypress trees" },
  { file: "djardin.jpg", key: "strossmayers-park-ardin", alt: "Strossmayer's Park (Đardin)" },
  { file: "podrumi.jpg", key: "the-substructures", alt: "The Substructures (Dioklecijanovi podrumi) of the palace" },
  { file: "marmontova.jpg", key: "marmont-street", alt: "Marmontova — a wide pedestrian shopping street" },
  { file: "ribarnica.jpg", key: "the-fish-market", alt: "The Fish Market (Ribarnica)" },
  { file: "pazar.jpg", key: "pazar-green-market", alt: "Pazar — the open-air green market" },
  { file: "matejuska.jpg", key: "matejuska-port", alt: "Matejuška — the fishermen's harbour promenade" },
  { file: "prokurative.jpg", key: "prokurative-republic-square", alt: "Prokurative (Republic Square)" },
  // ── the 4 genuinely-missing canonical POIs (create; coordinates = MANUAL REVIEW) ──
  { file: "Grgur Ninski.jpg", create: { key: "grgur-ninski", name: "Grgur Ninski (Gregory of Nin)", category: "landmark",
      short: "Meštrović's monumental statue of Bishop Gregory of Nin, by the Golden Gate.",
      long: "A monumental bronze statue of the medieval bishop Gregory of Nin (Grgur Ninski), sculpted by Ivan Meštrović, standing just outside the northern Golden Gate of Diocletian's Palace." },
    alt: "The monumental Grgur Ninski (Gregory of Nin) statue by Ivan Meštrović" },
  { file: "sv_frane.jpg", create: { key: "church-of-st-francis-sv-frane", name: "Church of St Francis (Sv. Frane)", category: "landmark",
      short: "Franciscan church and monastery on the western Riva.",
      long: "A Franciscan church and monastery on Split's waterfront, at the western end of the Riva promenade." },
    alt: "The Church of St Francis (Sv. Frane) on the Split waterfront" },
  { file: "zidine.jpg", create: { key: "palace-walls-zidine", name: "Palace Walls (Zidine palače)", category: "landmark",
      short: "The Roman walls enclosing Diocletian's Palace.",
      long: "The Roman defensive walls of Diocletian's Palace that enclose Split's historic core." },
    alt: "The Roman walls of Diocletian's Palace" },
  { file: "ulice.jpg", create: { key: "streets-of-diocletians-palace-ulice", name: "Streets of Diocletian's Palace (Ulice)", category: "landmark",
      short: "The narrow historic lanes inside Diocletian's Palace.",
      long: "The narrow stone lanes within the walls of Diocletian's Palace." },
    alt: "A narrow stone street inside Diocletian's Palace" },
];

// ── Module heroes → asset_usages (destination-shared vs hotel-owned) ──────────
const MODULE_HEROES = [
  // destination/local-area shared (all Split hotels reuse these)
  { file: "pharmacy.jpg", scope: "destination", module: "pharmacy", alt: "A local pharmacy in Split" },
  { file: "ferry_bus.jpg", scope: "destination", module: "ferry_bus", alt: "The Split ferry and bus port" },
  { file: "supermarket.jpg", scope: "destination", module: "supermarket", alt: "A supermarket in Split" },
  { file: "atm.jpg", scope: "destination", module: "atm", alt: "Using an ATM in Split's old town" },
  { file: "gastro.jpg", scope: "destination", module: "gastro", alt: "Seaside dining in Split" },
  // hotel-specific presentation (Antique Split only)
  { file: "room_guide.jpg", scope: "hotel", module: "room_guide", alt: "A hotel room with a view of the palace" },
  { file: "hotel_services.jpg", scope: "hotel", module: "hotel_services", alt: "Hotel housekeeping preparing a room" },
  { file: "concierge.jpg", scope: "hotel", module: "concierge", alt: "A hotel concierge assisting a guest" },
  { file: "help&request.jpg", scope: "hotel", module: "help_request", alt: "A reception desk service bell" },
];

const safeName = (s) => (basename(s).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "file");

async function upsertAsset({ file, scope, folder, alt, role }) {
  const abs = `${SRC}/${file}`;
  if (!existsSync(abs)) throw new Error(`missing image ${abs}`);
  const buf = readFileSync(abs);
  const hotelId = scope === "hotel" ? ANTIQUE : null;
  const destId = scope === "hotel" ? null : SPLIT;
  // idempotency: reuse an existing asset for this src_file within scope
  const found = (await sql.query(
    `select id, storage_path from public.assets where metadata->>'src_file' = $1 and coalesce(hotel_id::text,'')=coalesce($2::text,'') and coalesce(destination_id::text,'')=coalesce($3::text,'')`,
    [file, hotelId, destId])).rows[0];
  let id = found?.id;
  if (!id) id = (await sql.query(`select gen_random_uuid() id`)).rows[0].id;
  const root = scope === "hotel" ? `hotels/${ANTIQUE}` : `destinations/${SPLIT}`;
  const path = found?.storage_path || `${root}/${folder}/${id}/${safeName(file)}`;
  const up = await svc.storage.from("public-media").upload(path, buf, { contentType: "image/jpeg", upsert: true });
  if (up.error) throw new Error(`storage ${file}: ${up.error.message}`);
  const meta = JSON.stringify({ src_file: file, role });
  if (found) {
    await sql.query(`update public.assets set alt_text=$2, source_credit=$3, license_type=$4, rights_notes=$5, public_access=true, status='ready', file_size_bytes=$6, metadata=$7 where id=$1`,
      [id, alt, CREDIT, LICENSE_PENDING, LICENSE_PENDING, buf.length, meta]);
  } else {
    await sql.query(
      `insert into public.assets (id, hotel_id, destination_id, asset_type, bucket_name, storage_path, original_filename, display_name, mime_type, file_size_bytes, alt_text, source_credit, license_type, rights_notes, public_access, status, metadata)
       values ($1,$2,$3,$4,'public-media',$5,$6,$7,'image/jpeg',$8,$9,$10,$11,$11,true,'ready',$12)`,
      [id, hotelId, destId, scope === "poi" ? "poi_image" : "hotel_image", path, file, alt.slice(0, 80), buf.length, alt, CREDIT, LICENSE_PENDING, meta]);
  }
  return id;
}

async function publishPoi(id) {
  const snap = (await sql.query(`update public.destination_pois set status='published', active=true, published_at=coalesce(published_at,now()), updated_at=now() where id=$1 returning to_jsonb(destination_pois.*)-'published_snapshot' s`, [id])).rows[0].s;
  await sql.query(`update public.destination_pois set published_snapshot=$2 where id=$1`, [id, snap]);
}

async function main() {
  console.log("AI OLLY — Split POI + media completion (aiolly-dev)\n"); await sql.connect();
  let created = 0, updatedImg = 0, heroes = 0;

  for (const it of POI_IMAGES) {
    const assetId = await upsertAsset({ file: it.file, scope: "poi", folder: "poi", alt: it.alt, role: "poi_image" });
    let poi;
    if (it.create) {
      const c = it.create;
      const ex = (await sql.query(`select id from public.destination_pois where destination_id=$1 and key=$2`, [SPLIT, c.key])).rows[0];
      if (ex) { poi = ex.id; await sql.query(`update public.destination_pois set name=$2, category=$3, short_description=$4, body_content=$5, canonical_asset_id=$6 where id=$1`,
          [poi, c.name, c.category, c.short, JSON.stringify({ blocks: [{ type: "paragraph", text: c.long }] }), assetId]); }
      else { poi = (await sql.query(
          `insert into public.destination_pois (destination_id, key, name, category, short_description, body_content, canonical_asset_id, status, active, sort_order)
           values ($1,$2,$3,$4,$5,$6,$7,'draft',true, 900) returning id`,
          [SPLIT, c.key, c.name, c.category, c.short, JSON.stringify({ blocks: [{ type: "paragraph", text: c.long }] }), assetId])).rows[0].id; created++; }
      console.log(`  ＋ POI ${c.key} (${ex ? "updated" : "created"}) — coordinates: MANUAL REVIEW`);
    } else {
      const ex = (await sql.query(`select id from public.destination_pois where destination_id=$1 and key=$2`, [SPLIT, it.key])).rows[0];
      if (!ex) { console.log(`  ✗ expected POI ${it.key} not found`); continue; }
      poi = ex.id; await sql.query(`update public.destination_pois set canonical_asset_id=$2 where id=$1`, [poi, assetId]); updatedImg++;
    }
    await publishPoi(poi);
    await sql.query(`insert into public.asset_usages (asset_id, hotel_id, entity_type, entity_id, usage_role) values ($1,null,'poi',$2,'card') on conflict do nothing`, [assetId, poi]);
    if (it.destHero) {
      await sql.query(`insert into public.asset_usages (asset_id, hotel_id, entity_type, entity_id, usage_role) values ($1,null,'destination',$2,'hero') on conflict do nothing`, [assetId, SPLIT]);
      console.log(`  ★ destination hero = ${it.file}`);
    }
  }

  for (const h of MODULE_HEROES) {
    const assetId = await upsertAsset({ file: h.file, scope: h.scope, folder: "module", alt: h.alt, role: `module_hero:${h.module}` });
    const entityType = h.scope === "hotel" ? "hotel" : "destination";
    const entityId = h.scope === "hotel" ? ANTIQUE : SPLIT;
    const usageHotel = h.scope === "hotel" ? ANTIQUE : null;
    await sql.query(`insert into public.asset_usages (asset_id, hotel_id, entity_type, entity_id, usage_role) values ($1,$2,$3,$4,$5) on conflict do nothing`,
      [assetId, usageHotel, entityType, entityId, `module_hero:${h.module}`]);
    heroes++; console.log(`  🖼  ${h.scope === "hotel" ? "HOTEL " : "DEST  "} hero ${h.module} = ${h.file}`);
  }

  const withImg = (await sql.query(`select count(*)::int c from public.destination_pois where destination_id=$1 and canonical_asset_id is not null`, [SPLIT])).rows[0].c;
  const total = (await sql.query(`select count(*)::int c from public.destination_pois where destination_id=$1`, [SPLIT])).rows[0].c;
  console.log(`\n  Done. POIs created: ${created}, images assigned: ${updatedImg + POI_IMAGES.filter(i=>i.create).length}, module heroes: ${heroes}.`);
  console.log(`  Split POIs: ${total} total, ${withImg} with canonical image.`);
  await sql.end();
}
main().catch(async (e) => { console.error(e); try { await sql.end(); } catch {} process.exit(1); });
