// ============================================================================
// normalize-antique.mjs — raw/ → normalized/ (deterministic, Supabase-shaped).
// ----------------------------------------------------------------------------
// Pure transform. No network, no Supabase, no Airtable. Reads the read-only raw
// export and emits normalized records keyed by legacy_airtable_record_id, ready
// for the idempotent import. Never invents facts; never emits room tokens into any
// file except tokens.local.json (gitignored) consumed only by the import in-memory.
//
//   node scripts/migration/normalize-antique.mjs
// ============================================================================

import { join } from "node:path";
import { NORM_DIR, RAW_DIR, MANIFEST_DIR, ensureDirs, writeJson, readJson, HOTEL_SLUG, nowIso } from "./_lib.mjs";

const ARG_TS = process.argv.find((a) => a.startsWith("--ts="))?.slice(5);
const raw = (k) => readJson(join(RAW_DIR, `${k}.json`)).records;
const first = (v) => (Array.isArray(v) ? v[0] : v);
const val = (f, name) => { const v = f[name]; return v && typeof v === "object" && "name" in v ? v.name : v; };
const clean = (s) => (s == null ? null : String(s).replace(/\r\n/g, "\n").trim() || null);

function slugify(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 60);
}

// Room-type canonical slug from a free-text type label (SOBE tip OR ROOM GUIDE Room Type).
function typeSlug(label) {
  const s = String(label || "").toLowerCase();
  if (s.includes("deluxe") && s.includes("ground")) return "deluxe-ground-floor";
  if (s.includes("comfort")) return "comfort-ground-floor";
  if (s.includes("deluxe")) return "deluxe-room";
  if (s.includes("superior")) return "superior-room";
  if (s.includes("standard")) return "standard-room";
  return slugify(label);
}
const TYPE_NAME = {
  "deluxe-ground-floor": "Deluxe Ground Floor", "comfort-ground-floor": "Comfort Ground Floor",
  "deluxe-room": "Deluxe Room", "superior-room": "Superior Room", "standard-room": "Standard Room",
};

// ── text → structured blocks (conservative; never invents headings) ──────────
const BULLET = /^\s*[•\-\*•]\s+/;
const PRICE_LINE = /^(.+?)\s*[—\-–:]\s*([\d]+(?:[.,]\d+)?)\s*(?:€|eur)/i;
function textToBlocks(text) {
  const t = clean(text);
  if (!t) return { version: 1, blocks: [] };
  const blocks = [];
  for (const para of t.split(/\n{2,}/)) {
    const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const priced = lines.map((l) => PRICE_LINE.exec(l)).filter(Boolean);
    if (priced.length >= 2 && priced.length >= lines.length - 1) {
      blocks.push({ type: "price_list", items: priced.map((m) => ({ label: m[1].replace(BULLET, "").trim(), price: `${m[2]} €` })) });
      continue;
    }
    if (lines.every((l) => BULLET.test(l)) && lines.length > 1) {
      blocks.push({ type: "bullet_list", items: lines.map((l) => l.replace(BULLET, "").trim()) });
      continue;
    }
    blocks.push({ type: "paragraph", text: lines.join(" ") });
  }
  return { version: 1, blocks };
}
function parsePrices(text) {
  const t = clean(text); if (!t) return [];
  return t.split(/[\n•]/).map((l) => PRICE_LINE.exec(l.trim())).filter(Boolean)
    .map((m) => ({ label: m[1].replace(BULLET, "").trim(), amount: Number(m[2].replace(/\./g, "").replace(",", ".")) }))
    .filter((x) => x.label && Number.isFinite(x.amount));
}
function textToArray(text) {
  const t = clean(text); if (!t) return null;
  const items = t.split("\n").map((l) => l.replace(BULLET, "").trim()).filter(Boolean);
  return items.length ? items : null;
}

// AI_SOURCE multiselect → visibility flags.
function visibility(aiSource) {
  const arr = (Array.isArray(aiSource) ? aiSource : [aiSource]).map((x) => String(val({ x }, "x") ?? x?.name ?? x ?? "").toUpperCase());
  const has = (k) => arr.some((s) => s.includes(k));
  const web = has("WEB") || has("BOTH"), pwa = has("PWA") || has("BOTH");
  return { visible_in_web: web, visible_in_pwa: pwa, available_to_ai: web || pwa || arr.length === 0 };
}

function main() {
  ensureDirs();
  const generatedAt = nowIso(ARG_TS);
  const out = { generatedAt, hotelSlug: HOTEL_SLUG };

  // ── Tenancy (canonical values per Sprint 9 Part 4) ────────────────────────
  const hotelRow = raw("hotel").find((r) => val(r.fields, "Slug") === HOTEL_SLUG);
  out.destination = { slug: "split", name: "Split", country_code: "HR", timezone: "Europe/Zagreb", default_locale: "en" };
  out.hotel = {
    legacy_airtable_id: hotelRow?.id ?? null,
    slug: HOTEL_SLUG, name: hotelRow ? val(hotelRow.fields, "Hotel naziv") : "Antique Split",
    address_line: "Poljana Grgura Ninskog 1", city: "Split", postal_code: "21000", country_code: "HR",
    timezone: "Europe/Zagreb", currency: "EUR", default_locale: "en",
    reception_phone: "+385 21 785 208", reception_mobile: "+385 91 525 6985",
    reception_email: hotelRow ? clean(val(hotelRow.fields, "Notification Email") || val(hotelRow.fields, "Email")) : null,
    check_in_time: "14:00", check_out_time: "11:00",
    settings: {
      google_maps: hotelRow ? clean(val(hotelRow.fields, "Google Maps")) : null,
      google_review: hotelRow ? clean(val(hotelRow.fields, "Google Review")) : null,
      instagram: hotelRow ? clean(val(hotelRow.fields, "Instagram")) : null,
      whatsapp: hotelRow ? clean(val(hotelRow.fields, "WhatsApp")) : null,
      emergency_number: hotelRow ? clean(val(hotelRow.fields, "Emergency Number")) : "112",
      medical_number: hotelRow ? clean(val(hotelRow.fields, "Medical Emergency Number")) : "194",
    },
  };

  // ── Room types (from 5 slugged SOBE rows) ─────────────────────────────────
  const sobe = raw("rooms").filter((r) => val(r.fields, "Hotel Slug (text)") === HOTEL_SLUG);
  const typeMap = new Map();
  let tsort = 0;
  for (const r of sobe) {
    const tslug = typeSlug(val(r.fields, "Tip sobe"));
    if (typeMap.has(tslug)) continue;
    const view = val(r.fields, "View");
    typeMap.set(tslug, {
      legacy_airtable_record_id: r.id, slug: tslug, name: TYPE_NAME[tslug] || val(r.fields, "Tip sobe"),
      description: clean(val(r.fields, "Opis sobe")), active: r.fields.Active !== false, sort_order: tsort++,
      default_capacity: val(r.fields, "Kapacitet (osoba)") ?? null,
      default_bed_configuration: (r.fields["Kreveti"] || r.fields["Bed's"] || []).map((x) => x?.name ?? x).join(", ") || null,
      _view: view && !/no special/i.test(view) ? clean(view) : null,
      // room-guide-derived fields filled below
      wifi_instructions: null, ac_instructions: null, tv_instructions: null, safe_instructions: null,
      smart_glass: false, smart_glass_instructions: null, ai_welcome: null,
      room_features: null, room_notes: null, toiletries: null,
    });
  }

  // ── Rooms (8 ROOM GUIDE rows) + enrich types + token map ──────────────────
  const rg = raw("room_guide").filter((r) => r.fields["Access Token"]);
  const rooms = [], tokenMap = {};
  for (const r of rg.sort((a, b) => String(val(a.fields, "Naziv sobe")).localeCompare(String(val(b.fields, "Naziv sobe"))))) {
    const f = r.fields;
    const roomNumber = String(val(f, "Naziv sobe")).trim();
    const tslug = typeSlug(val(f, "Room Type"));
    const type = typeMap.get(tslug);
    const smart = !!clean(val(f, "Smart Glass"));
    // enrich the type from the first room seen (deterministic: rooms sorted by number)
    if (type) {
      if (!type.wifi_instructions) type.wifi_instructions = clean(val(f, "WiFi"));
      if (!type.ac_instructions) type.ac_instructions = clean(val(f, "Upute Klima"));
      if (!type.tv_instructions) type.tv_instructions = clean(val(f, "Upute TV"));
      if (!type.safe_instructions) type.safe_instructions = clean(val(f, "Upute Sef"));
      if (!type.ai_welcome) type.ai_welcome = clean(val(f, "AI WELCOME"));
      if (!type.room_notes) type.room_notes = textToArray(val(f, "Napomene"));
      if (!type.room_features) type.room_features = textToArray(val(f, "Room features/Communication"));
      if (smart) { type.smart_glass = true; if (!type.smart_glass_instructions) type.smart_glass_instructions = clean(val(f, "Smart Glass")); }
    }
    tokenMap[roomNumber] = val(f, "Access Token"); // secret — tokens.local.json only
    rooms.push({
      legacy_airtable_record_id: r.id, room_number: roomNumber, room_type_slug: tslug,
      active: f.Active !== false, floor: /^(\d)/.test(roomNumber) ? Number(roomNumber[0]) : null,
      view_description_override: type?._view ?? null,
      smart_glass_override: type ? (smart === type.smart_glass ? null : smart) : smart,
      ai_welcome_override: null, // type-level welcome suffices; per-room diff omitted (none observed)
      _hasToken: true,
    });
  }
  out.room_types = [...typeMap.values()].map(({ _view, ...t }) => t);
  out.rooms = rooms;

  // ── Service categories + services ─────────────────────────────────────────
  const services = raw("services").filter((r) => r._scope === HOTEL_SLUG);
  const catMap = new Map(); let csort = 0;
  for (const r of services) {
    const name = val(r.fields, "Kategorija") || "General";
    const key = slugify(name);
    if (!catMap.has(key)) catMap.set(key, { key, name: String(name), sort_order: csort++, active: true, legacy_airtable_record_id: null });
  }
  out.service_categories = [...catMap.values()];
  const seenKey = new Set();
  out.services = services.map((r, i) => {
    const f = r.fields;
    const title = clean(val(f, "Naziv usluge")) || `Service ${i + 1}`;
    let key = slugify(title); while (seenKey.has(key)) key = `${key}-${i}`; seenKey.add(key);
    const vis = visibility(f["AI_SOURCE"]);
    return {
      legacy_airtable_record_id: r.id, key, title,
      category_key: slugify(val(f, "Kategorija") || "General"),
      short_description: clean(val(f, "Opis"))?.slice(0, 240) ?? null,
      body_content: textToBlocks(val(f, "Opis")),
      active: f.Active === true, status: f.Active === true ? "published" : "draft",
      ...vis,
      opening_hours: clean(val(f, "Radno vrijeme")),
    };
  });

  // ── Destination POIs + hotel presentation settings ────────────────────────
  const poi = raw("poi");
  out.pois = poi.map((r, i) => {
    const f = r.fields;
    return {
      legacy_airtable_record_id: r.id, key: slugify(val(f, "POI Naziv")) || `poi-${i}`,
      name: clean(val(f, "POI Naziv")), category: clean(val(f, "Kategorije")),
      short_description: clean(val(f, "Opis (kratki/hook)")),
      body_content: textToBlocks(val(f, "Opis (dugi)")),
      latitude: f.Latitude ?? null, longitude: f.Longitude ?? null, address: clean(val(f, "Adresa")),
      active: f.Aktivno !== false, sort_order: f["Sort Order"] ?? i,
      _settings: { visible: f.Aktivno !== false, walking_time_minutes: null, sort_order_override: f["Sort Order"] ?? null,
        hotel_recommendation: clean(val(f, "Napomena")) },
    };
  });

  // ── Destination routes ────────────────────────────────────────────────────
  const routes = raw("routes");
  const durMin = (v) => { const m = /(\d+)/.exec(String(v || "")); return m ? Number(m[1]) : null; };
  out.routes = routes.map((r, i) => {
    const f = r.fields;
    return {
      legacy_airtable_record_id: r.id, key: slugify(val(f, "Ruta naziv")) || `route-${i}`,
      name: clean(val(f, "Ruta naziv")), short_description: clean(val(f, "Opis rute")),
      body_content: textToBlocks(val(f, "Opis rute")), duration_minutes: durMin(val(f, "Trajanje (min)")),
      difficulty: null, waypoints: { order_text: clean(val(f, "Redoslijed (AI koristi)")) ?? null, pois_linked: false },
      active: f.Aktivno === true, sort_order: i,
      _settings: { visible: f.Aktivno === true, featured: false },
    };
  });

  // ── Destination events ────────────────────────────────────────────────────
  const events = raw("events");
  out.events = events.map((r, i) => {
    const f = r.fields;
    const d = clean(val(f, "Datum"));
    return {
      legacy_airtable_record_id: r.id, key: slugify(val(f, "Naziv")) || `event-${i}`,
      title: clean(val(f, "Naziv")), short_description: clean(val(f, "Opis")),
      body_content: textToBlocks(val(f, "Opis")),
      starts_at: d ? `${d}T00:00:00Z` : null, all_day: true, recurrence: /always/i.test(val(f, "Tip") || "") ? "always" : null,
      active: f.Aktivan !== false, sort_order: i, _link: clean(val(f, "Link")),
      _settings: { visible: f.Aktivan !== false },
    };
  });

  // ── AI config (persona/tone/output/safe-handoff) ──────────────────────────
  const aiCtx = raw("ai_context");
  const fallback = raw("ai_fallback");
  const outputRules = raw("ai_output_rules");
  out.ai_config = {
    persona: { voice: hotelRow ? clean(val(hotelRow.fields, "Persona Voice")) : null,
      contexts: aiCtx.map((r) => ({ scope: val(r.fields, "Scope"), tone: clean(val(r.fields, "Ton/Stil")), rules: clean(val(r.fields, "Do/Don't")) })) },
    tone: aiCtx.map((r) => clean(val(r.fields, "Ton/Stil"))).filter(Boolean)[0] ?? null,
    response_formatting: { rules: outputRules.filter((r) => r.fields.Active !== false).map((r) => ({ scope: val(r.fields, "Scope"), format: val(r.fields, "Format"), style: clean(val(r.fields, "Style")) })) },
    safe_handoff_text: fallback.map((r) => clean(val(r.fields, "AI Response"))).filter(Boolean)[0] ?? null,
  };

  // ── AI intent-pattern classification (counts only; not a 1:1 import) ──────
  const intents = raw("ai_intent");
  const cls = { replaced_by_entity: 0, retained_alias: 0, room_deterministic: 0, obsolete: 0, manual: 0 };
  const aliases = [];
  for (const r of intents) {
    const f = r.fields;
    const hasSvc = (f["Services link"] || []).length > 0;
    const hasRoom = (f["Rooms link"] || []).length > 0;
    const phrases = clean(f["Phrases"]);
    if (hasRoom) cls.room_deterministic++;
    else if (hasSvc && phrases) { cls.retained_alias++; cls.replaced_by_entity++;
      aliases.push({ intent_key: slugify(val(f, "Intent")), service_legacy_ids: f["Services link"], phrases: phrases.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 12) }); }
    else if (!phrases) cls.obsolete++;
    else cls.manual++;
  }
  out.ai_classification = { total: intents.length, ...cls };
  out.ai_aliases = aliases; // reference for the AI report; import attaches a curated subset

  // ── Prices (structured price-list services only; VAT/validity NOT inferred) ─
  const priceItems = [];
  for (const r of services) {
    const title = clean(val(r.fields, "Naziv usluge")) || "";
    if (!/price\s*list|cjenik|prices/i.test(title)) continue;
    for (const p of parsePrices(val(r.fields, "Opis"))) {
      priceItems.push({ category_key: "hotel-services", key: slugify(`${title}-${p.label}`), name: p.label,
        amount: p.amount, currency: "EUR", vat_included: null, billing_unit: "flat", source_legacy: r.id, needs_review: true });
    }
  }
  out.price_categories = priceItems.length ? [{ key: "hotel-services", name: "Hotel Services", sort_order: 0, active: true }] : [];
  out.price_items = priceItems;

  // ── Media manifest (no Airtable binaries present) ─────────────────────────
  out.media_manifest = { airtable_attachments: 0, note: "No attachments in any content table. Imagery is external/pending (hero slots, icons). Nothing to copy into Storage.", items: [] };

  // write normalized bundle + token map (gitignored)
  const chk = writeJson(join(NORM_DIR, "antique-split.normalized.json"), out);
  writeJson(join(NORM_DIR, "tokens.local.json"), { generatedAt, note: "SECRET room access tokens — consumed by import in-memory only; never commit/log/show.", tokens: tokenMap });
  writeJson(join(MANIFEST_DIR, "normalize-summary.json"), {
    generatedAt, checksum: chk,
    counts: { destination: 1, hotel: 1, room_types: out.room_types.length, rooms: out.rooms.length, service_categories: out.service_categories.length,
      services: out.services.length, pois: out.pois.length, routes: out.routes.length, events: out.events.length,
      price_items: out.price_items.length, ai_aliases: out.ai_aliases.length },
    ai_classification: out.ai_classification,
  });

  console.log("Normalize complete (deterministic):");
  console.log(`  room_types=${out.room_types.length} rooms=${out.rooms.length}(tokens mapped, not logged) services=${out.services.length} categories=${out.service_categories.length}`);
  console.log(`  pois=${out.pois.length} routes=${out.routes.length} events=${out.events.length} price_items=${out.price_items.length}`);
  console.log(`  ai_classification:`, JSON.stringify(out.ai_classification));
  console.log(`  normalized/antique-split.normalized.json (sha256 ${chk.slice(0, 12)}…)`);
}
main();
