// ============================================================================
// AI OLLY Dashboard — DEV Asset seed (aiolly-dev only).
// ----------------------------------------------------------------------------
// Synthetic assets for Sprint 6, generated locally (SVG/PDF/placeholder audio) —
// NO Antique Split media. Uploads to the real dev buckets via service-role and
// creates asset + asset_usage rows: hotel logo, room hero, destination POI, a
// PDF, audio metadata, an external Vimeo example, a PRIVATE consent signature +
// document, used/unused, missing-alt, missing-rights, and an archived asset.
// Idempotent (deterministic paths, upsert). Reserved domains, non-personal.
//
//   node dashboard/scripts/setup-dev-assets.mjs
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const svc = createClient(readEnv("SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const svg = (label, color, w = 400, h = 260) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${color}"/><text x="50%" y="50%" fill="#ffffff" font-family="sans-serif" font-size="22" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`, "utf8");
const sigSvg = () => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120" viewBox="0 0 360 120"><rect width="360" height="120" fill="#ffffff"/><path d="M20 80 C60 20 90 110 130 60 S200 20 240 70 300 100 340 50" fill="none" stroke="#111" stroke-width="3"/></svg>`, "utf8");
const audioPlaceholder = () => Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0]), Buffer.alloc(2048, 0)]); // ID3 header + silence
function buildPdf(title) {
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 180]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
  ];
  const stream = `BT /F1 16 Tf 30 120 Td (${title}) Tj 0 -24 Td (SYNTHETIC dev only) Tj ET`;
  objs.push(`<</Length ${stream.length}>>\nstream\n${stream}\nendstream`);
  objs.push("<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>");
  let pdf = "%PDF-1.4\n"; const offsets = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { pdf += String(off).padStart(10, "0") + " 00000 n \n"; });
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

async function upsertAsset(match, row, fileBuf, bucket, path, contentType) {
  if (fileBuf) { const up = await svc.storage.from(bucket).upload(path, fileBuf, { contentType, upsert: true }); if (up.error) throw new Error(`upload ${path}: ${up.error.message}`); }
  let q = svc.from("assets").select("id"); for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
  const f = await q.maybeSingle();
  if (f.data?.id) { const u = await svc.from("assets").update(row).eq("id", f.data.id); if (u.error) throw new Error(`update ${path}: ${u.error.message}`); return f.data.id; }
  const r = await svc.from("assets").insert({ ...match, ...row }).select("id").single();
  if (r.error) throw new Error(`asset ${path ?? match.external_url}: ${r.error.message}`);
  return r.data.id;
}
async function upsertUsage(assetId, hotelId, entityType, entityId, usageRole) {
  const f = await svc.from("asset_usages").select("id").match({ asset_id: assetId, entity_type: entityType, entity_id: entityId, usage_role: usageRole }).maybeSingle();
  if (!f.data) { const r = await svc.from("asset_usages").insert({ asset_id: assetId, hotel_id: hotelId, entity_type: entityType, entity_id: entityId, usage_role: usageRole }); if (r.error) throw new Error(`usage ${usageRole}: ${r.error.message}`); }
}

async function main() {
  console.log("AI OLLY asset seed →", readEnv("SUPABASE_URL"), "\n");
  const { data: hotel } = await svc.from("hotels").select("id,destination_id").eq("slug", "dash-demo-hotel").single();
  if (!hotel) throw new Error("run setup-dev-user.mjs first");
  const H = hotel.id, D = hotel.destination_id;
  const { data: room } = await svc.from("rooms").select("id").eq("hotel_id", H).order("room_number").limit(1).single();
  const roomId = room?.id;

  const pub = "public-media", pdocs = "private-documents", cfiles = "consent-files";
  const base = (name, type, extra = {}) => ({ display_name: name, asset_type: type, status: "ready", public_access: false, ...extra });

  // 1 logo (used) — hotel, public
  const logo = await upsertAsset({ storage_path: `hotels/${H}/logos/logo.svg` }, base("Demo Hotel logo", "logo", { hotel_id: H, bucket_name: pub, mime_type: "image/svg+xml", public_access: true, rights_owner: "Demo Hotel", license_type: "owned", alt_text: "Demo Hotel logo", file_size_bytes: null, width: 400, height: 260 }), svg("Demo Hotel", "#1a3445"), pub, `hotels/${H}/logos/logo.svg`, "image/svg+xml");
  await svc.from("assets").update({ file_size_bytes: svg("Demo Hotel", "#1a3445").length }).eq("id", logo);
  await upsertUsage(logo, H, "hotel", H, "logo");

  // 2 room hero (used) — hotel, public, has alt+rights
  const heroBuf = svg("Room Hero", "#2c5a70");
  const hero = await upsertAsset({ storage_path: `hotels/${H}/rooms/hero.svg` }, base("Deluxe room hero", "room_image", { hotel_id: H, bucket_name: pub, mime_type: "image/svg+xml", public_access: true, alt_text: "Sunlit deluxe room with sea view", rights_owner: "Demo Hotel", license_type: "owned", file_size_bytes: heroBuf.length, width: 400, height: 260 }), heroBuf, pub, `hotels/${H}/rooms/hero.svg`, "image/svg+xml");
  if (roomId) await upsertUsage(hero, H, "room", roomId, "hero");

  // 3 destination POI (used) — destination scope, public
  const poiBuf = svg("Old Town", "#6a7f4f");
  const poi = await upsertAsset({ storage_path: `destinations/${D}/poi/oldtown.svg` }, base("Old Town POI", "poi_image", { hotel_id: null, destination_id: D, bucket_name: pub, mime_type: "image/svg+xml", public_access: true, alt_text: "Old town square", rights_owner: "Destination DMO", license_type: "cc-by", file_size_bytes: poiBuf.length, width: 400, height: 260 }), poiBuf, pub, `destinations/${D}/poi/oldtown.svg`, "image/svg+xml");
  await upsertUsage(poi, H, "poi", H, "card");

  // 4 document PDF — hotel, PRIVATE (private-documents)
  const docBuf = buildPdf("Hotel Fact Sheet");
  await upsertAsset({ storage_path: `hotels/${H}/documents/fact-sheet.pdf` }, base("Hotel fact sheet", "document", { hotel_id: H, bucket_name: pdocs, mime_type: "application/pdf", file_size_bytes: docBuf.length }), docBuf, pdocs, `hotels/${H}/documents/fact-sheet.pdf`, "application/pdf");

  // 5 audio metadata — hotel, public
  const audioBuf = audioPlaceholder();
  await upsertAsset({ storage_path: `hotels/${H}/audio/welcome.mp3` }, base("Welcome audio (whisper)", "whisper_audio", { hotel_id: H, bucket_name: pub, mime_type: "audio/mpeg", public_access: true, duration_seconds: 42, file_size_bytes: audioBuf.length, rights_owner: "Demo Hotel", license_type: "owned" }), audioBuf, pub, `hotels/${H}/audio/welcome.mp3`, "audio/mpeg");

  // 6 external Vimeo — metadata only
  await upsertAsset({ external_url: "https://vimeo.com/000000000" }, base("Hotel tour (Vimeo)", "short_video", { hotel_id: H, external_provider: "vimeo", external_id: "000000000", caption: "Synthetic external video example", rights_owner: "Demo Hotel", license_type: "owned" }), null, null, null, null);

  // 7 private consent signature — hotel, PRIVATE (consent-files)
  const sigBuf = sigSvg();
  await upsertAsset({ storage_path: `hotels/${H}/consent-signatures/sample/sig.svg` }, base("Sample consent signature", "consent_signature", { hotel_id: H, bucket_name: cfiles, mime_type: "image/svg+xml", file_size_bytes: sigBuf.length }), sigBuf, cfiles, `hotels/${H}/consent-signatures/sample/sig.svg`, "image/svg+xml");

  // 8 private consent document — hotel, PRIVATE (private-documents)
  const cpdfBuf = buildPdf("Signed Consent Record");
  await upsertAsset({ storage_path: `hotels/${H}/consent-pdfs/sample/consent.pdf` }, base("Sample consent document", "consent_pdf", { hotel_id: H, bucket_name: pdocs, mime_type: "application/pdf", file_size_bytes: cpdfBuf.length }), cpdfBuf, pdocs, `hotels/${H}/consent-pdfs/sample/consent.pdf`, "application/pdf");

  // 9 unused — hotel, public, complete metadata, no usage
  const unusedBuf = svg("Promo", "#8a5a2b");
  await upsertAsset({ storage_path: `hotels/${H}/news/promo.svg` }, base("Spring promo banner", "news_image", { hotel_id: H, bucket_name: pub, mime_type: "image/svg+xml", public_access: true, alt_text: "Spring promotion", rights_owner: "Demo Hotel", license_type: "owned", file_size_bytes: unusedBuf.length, width: 400, height: 260 }), unusedBuf, pub, `hotels/${H}/news/promo.svg`, "image/svg+xml");

  // 10 missing ALT — hotel image, no alt_text
  const maBuf = svg("Lobby", "#4a4a4a");
  await upsertAsset({ storage_path: `hotels/${H}/images/lobby.svg` }, base("Lobby photo", "hotel_image", { hotel_id: H, bucket_name: pub, mime_type: "image/svg+xml", public_access: true, alt_text: null, rights_owner: "Demo Hotel", license_type: "owned", file_size_bytes: maBuf.length, width: 400, height: 260 }), maBuf, pub, `hotels/${H}/images/lobby.svg`, "image/svg+xml");

  // 11 missing RIGHTS — hotel image, no rights_owner/license
  const mrBuf = svg("Pool", "#2f6f6f");
  await upsertAsset({ storage_path: `hotels/${H}/images/pool.svg` }, base("Pool photo", "hotel_image", { hotel_id: H, bucket_name: pub, mime_type: "image/svg+xml", public_access: true, alt_text: "Outdoor pool at dusk", rights_owner: null, license_type: null, file_size_bytes: mrBuf.length, width: 400, height: 260 }), mrBuf, pub, `hotels/${H}/images/pool.svg`, "image/svg+xml");

  // 12 archived — icon, soft-deleted
  const icoBuf = svg("★", "#333", 120, 120);
  const ico = await upsertAsset({ storage_path: `hotels/${H}/icons/star.svg` }, base("Star icon", "icon", { hotel_id: H, bucket_name: pub, mime_type: "image/svg+xml", public_access: true, alt_text: "Star", rights_owner: "Demo Hotel", license_type: "owned", file_size_bytes: icoBuf.length, width: 120, height: 120 }), icoBuf, pub, `hotels/${H}/icons/star.svg`, "image/svg+xml");
  await svc.from("assets").update({ deleted_at: new Date().toISOString(), status: "archived" }).eq("id", ico);

  console.log("  ✓ 12 assets: logo/room-hero/POI (used), PDF + audio + Vimeo, private signature + document,");
  console.log("    unused, missing-alt, missing-rights, archived. Files uploaded to public-media/private-documents/consent-files.");
  console.log("\n  Done. Open Assets.\n");
}
main().catch((e) => { console.error("  seed error:", e.message); process.exit(1); });
