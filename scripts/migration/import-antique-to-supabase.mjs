// ============================================================================
// import-antique-to-supabase.mjs — normalized/ → aiolly-dev (idempotent, DEV-ONLY).
// ----------------------------------------------------------------------------
//   node scripts/migration/import-antique-to-supabase.mjs [--apply]
//     (default = --dry-run: runs the whole import in a transaction and ROLLS BACK)
//
// Guarantees:
//   • assertDevSupabase() — refuses any Supabase ref except aiolly-dev.
//   • Never connects to Airtable (this stage is Supabase-only).
//   • Idempotent: upsert on natural keys / legacy_airtable_record_id. Rerun reconciles,
//     never duplicates. Room access tokens set exactly from raw; never rotated/logged.
//   • Parameterized queries only. Single transaction. No cross-hotel writes.
//   • Writes manifests/legacy-id-map.json (no tokens) after a successful apply.
// ============================================================================

import pg from "pg";
import { join } from "node:path";
import { assertDevSupabase, readEnv, readJson, writeJson, NORM_DIR, MANIFEST_DIR, HOTEL_SLUG, IMPORT_VERSION, nowIso } from "./_lib.mjs";

const APPLY = process.argv.includes("--apply");
const MODE = APPLY ? "APPLY" : "DRY-RUN";

function mapPoiCategory(s) {
  const t = String(s || "").toLowerCase();
  if (/beach|plaž/.test(t)) return "beach";
  if (/museum|muzej/.test(t)) return "museum";
  if (/restaurant|food|hrana|konoba/.test(t)) return "restaurant";
  if (/caf|kav/.test(t)) return "cafe";
  if (/\bbar\b|wine|cocktail/.test(t)) return "bar";
  if (/park|nature|green|priroda/.test(t)) return "nature";
  if (/shop|shopping|trgov/.test(t)) return "shop";
  if (/church|palace|palača|monument|landmark|square|trg|heritage|povij/.test(t)) return "landmark";
  if (/transport|ferry|bus|trajekt/.test(t)) return "transport";
  if (/night|club|klub/.test(t)) return "nightlife";
  if (/activity|tour|walk|experience/.test(t)) return "activity";
  return "other";
}

async function main() {
  const ref = assertDevSupabase();
  console.log(`Antique Split import → aiolly-dev (${ref}) — ${MODE}\n`);
  const bundle = readJson(join(NORM_DIR, "antique-split.normalized.json"));
  const tokens = readJson(join(NORM_DIR, "tokens.local.json")).tokens;

  const client = new pg.Client({ connectionString: readEnv("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });
  await client.connect();
  const q = (text, params) => client.query(text, params);
  const stats = {};
  const bump = (k, inserted) => { stats[k] ??= { created: 0, updated: 0 }; inserted ? stats[k].created++ : stats[k].updated++; };
  const idMap = { destinations: {}, hotels: {}, room_types: {}, rooms: {}, service_categories: {}, hotel_services: {}, destination_pois: {}, destination_routes: {}, destination_events: {}, price_categories: {}, price_items: {} };

  // upsert on a UNIQUE constraint; xmax=0 ⇒ inserted
  async function upsertUnique(table, conflict, row, statKey, legacyKey) {
    const cols = Object.keys(row), vals = Object.values(row);
    const ins = cols.map((_, i) => `$${i + 1}`).join(",");
    const upd = cols.filter((c) => !conflict.includes(c)).map((c) => `${c}=excluded.${c}`).join(",");
    const sql = `insert into ${table} (${cols.join(",")}) values (${ins})
      on conflict (${conflict.join(",")}) do update set ${upd}, updated_at=now()
      returning id, (xmax=0) as inserted`;
    const r = await q(sql, vals);
    bump(statKey, r.rows[0].inserted);
    if (legacyKey && row[legacyKey] != null) idMap[table][row[legacyKey]] = r.rows[0].id;
    return r.rows[0].id;
  }
  // select-then-update/insert for tables lacking a natural unique constraint
  async function upsertByKey(table, matchCols, row, statKey, legacyKey) {
    const where = matchCols.map((c, i) => `${c}=$${i + 1}`).join(" and ");
    const ex = await q(`select id from ${table} where ${where} limit 1`, matchCols.map((c) => row[c]));
    let id, inserted;
    if (ex.rows[0]) {
      id = ex.rows[0].id; inserted = false;
      const setCols = Object.keys(row).filter((c) => !matchCols.includes(c));
      await q(`update ${table} set ${setCols.map((c, i) => `${c}=$${i + 1}`).join(",")}, updated_at=now() where id=$${setCols.length + 1}`,
        [...setCols.map((c) => row[c]), id]);
    } else {
      const cols = Object.keys(row), vals = Object.values(row);
      const r = await q(`insert into ${table} (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`, vals);
      id = r.rows[0].id; inserted = true;
    }
    bump(statKey, inserted);
    if (legacyKey && row[legacyKey] != null) idMap[table][row[legacyKey]] = id;
    return id;
  }
  const J = (v) => JSON.stringify(v ?? null);

  try {
    await q("begin");

    // 1) destination
    const d = bundle.destination;
    const destId = await upsertUnique("destinations", ["slug"],
      // status uses content_status now (draft|preview|published|archived); a
      // migrated Split destination is live → "published" (was "active" pre-Phase-2).
      { slug: d.slug, name: d.name, country_code: d.country_code, timezone: d.timezone, default_locale: d.default_locale, status: "published" }, "destinations");

    // 2) hotel
    const h = bundle.hotel;
    const hotelId = await upsertUnique("hotels", ["slug"], {
      slug: h.slug, name: h.name, destination_id: destId, status: "active", timezone: h.timezone, default_locale: h.default_locale,
      currency: h.currency, country_code: h.country_code, address_line: h.address_line, city: h.city, postal_code: h.postal_code,
      reception_phone: h.reception_phone, reception_mobile: h.reception_mobile, reception_email: h.reception_email,
      check_in_time: h.check_in_time, check_out_time: h.check_out_time, legacy_airtable_id: h.legacy_airtable_id, settings: J(h.settings),
    }, "hotels");

    // 3) room_types
    const typeIdBySlug = {};
    for (const t of bundle.room_types) {
      typeIdBySlug[t.slug] = await upsertUnique("room_types", ["hotel_id", "slug"], {
        hotel_id: hotelId, slug: t.slug, name: t.name, description: t.description, active: t.active, sort_order: t.sort_order,
        default_capacity: t.default_capacity, default_bed_configuration: t.default_bed_configuration,
        wifi_instructions: t.wifi_instructions, ac_instructions: t.ac_instructions, tv_instructions: t.tv_instructions,
        safe_instructions: t.safe_instructions, smart_glass: t.smart_glass, smart_glass_instructions: t.smart_glass_instructions,
        ai_welcome: t.ai_welcome, room_features: t.room_features, room_notes: t.room_notes, toiletries: t.toiletries,
        legacy_airtable_record_id: t.legacy_airtable_record_id,
      }, "room_types", "legacy_airtable_record_id");
    }

    // 4) rooms (tokens preserved exactly; never logged)
    for (const r of bundle.rooms) {
      const token = tokens[r.room_number];
      if (!token) throw new Error(`Missing token for room ${r.room_number} — refusing to insert a room without preserving its access token.`);
      await upsertUnique("rooms", ["hotel_id", "room_number"], {
        hotel_id: hotelId, room_type_id: typeIdBySlug[r.room_type_slug], room_number: r.room_number, access_token: token,
        active: r.active, floor: r.floor, view_description_override: r.view_description_override,
        smart_glass_override: r.smart_glass_override, ai_welcome_override: r.ai_welcome_override,
        legacy_airtable_record_id: r.legacy_airtable_record_id,
      }, "rooms", "legacy_airtable_record_id");
    }

    // 5) service_categories
    const catIdByKey = {};
    for (const c of bundle.service_categories) {
      catIdByKey[c.key] = await upsertByKey("service_categories", ["hotel_id", "key"],
        { hotel_id: hotelId, key: c.key, name: c.name, sort_order: c.sort_order, active: c.active }, "service_categories");
    }

    // 6) hotel_services
    for (const s of bundle.services) {
      const published = s.status === "published";
      await upsertByKey("hotel_services", ["hotel_id", "key"], {
        hotel_id: hotelId, category_id: catIdByKey[s.category_key] ?? catIdByKey[bundle.service_categories[0]?.key], key: s.key,
        title: s.title, short_description: s.short_description, body_content: J(s.body_content), status: s.status, active: s.active,
        visible_in_pwa: s.visible_in_pwa, visible_in_web: s.visible_in_web, available_to_ai: s.available_to_ai,
        is_critical: false, source_type: "hotel", published_at: published ? new Date(nowIso()).toISOString() : null,
        published_snapshot: published ? J(s.body_content) : null, legacy_airtable_record_id: s.legacy_airtable_record_id,
      }, "hotel_services", "legacy_airtable_record_id");
    }

    // 7) destination_pois + 8) hotel_poi_settings
    for (const p of bundle.pois) {
      const poiId = await upsertUnique("destination_pois", ["destination_id", "key"], {
        destination_id: destId, key: p.key, name: p.name, category: mapPoiCategory(p.category), short_description: p.short_description,
        body_content: J(p.body_content), latitude: p.latitude, longitude: p.longitude, address: p.address,
        status: "published", active: p.active, sort_order: p.sort_order, published_at: new Date(nowIso()).toISOString(),
        legacy_airtable_record_id: p.legacy_airtable_record_id,
      }, "destination_pois", "legacy_airtable_record_id");
      await upsertUnique("hotel_poi_settings", ["hotel_id", "poi_id"], {
        hotel_id: hotelId, poi_id: poiId, visible: p._settings.visible, featured: false,
        sort_order_override: p._settings.sort_order_override, hotel_recommendation: p._settings.hotel_recommendation,
      }, "hotel_poi_settings");
    }

    // 9) destination_routes + 10) hotel_route_settings
    for (const r of bundle.routes) {
      const routeId = await upsertUnique("destination_routes", ["destination_id", "key"], {
        destination_id: destId, key: r.key, name: r.name, short_description: r.short_description, body_content: J(r.body_content),
        difficulty: r.difficulty, duration_minutes: r.duration_minutes, waypoints: J(r.waypoints), status: "published",
        active: r.active, sort_order: r.sort_order, published_at: new Date(nowIso()).toISOString(),
        legacy_airtable_record_id: r.legacy_airtable_record_id,
      }, "destination_routes", "legacy_airtable_record_id");
      await upsertUnique("hotel_route_settings", ["hotel_id", "route_id"],
        { hotel_id: hotelId, route_id: routeId, visible: r._settings.visible, featured: r._settings.featured }, "hotel_route_settings");
    }

    // 11) destination_events + 12) hotel_event_settings
    for (const e of bundle.events) {
      const eventId = await upsertUnique("destination_events", ["destination_id", "key"], {
        destination_id: destId, key: e.key, title: e.title, short_description: e.short_description, body_content: J(e.body_content),
        starts_at: e.starts_at, all_day: e.all_day, recurrence: e.recurrence, status: "published", active: e.active,
        sort_order: e.sort_order, published_at: new Date(nowIso()).toISOString(), legacy_airtable_record_id: e.legacy_airtable_record_id,
      }, "destination_events", "legacy_airtable_record_id");
      await upsertUnique("hotel_event_settings", ["hotel_id", "event_id"],
        { hotel_id: hotelId, event_id: eventId, visible: e._settings.visible, featured: false }, "hotel_event_settings");
    }

    // 13) price_categories + 14) price_items
    const priceCatIdByKey = {};
    for (const pc of bundle.price_categories) {
      priceCatIdByKey[pc.key] = await upsertByKey("price_categories", ["hotel_id", "key"],
        { hotel_id: hotelId, key: pc.key, name: pc.name, sort_order: pc.sort_order, active: pc.active }, "price_categories");
    }
    for (const pi of bundle.price_items) {
      await upsertByKey("price_items", ["hotel_id", "key"], {
        hotel_id: hotelId, category_id: priceCatIdByKey[pi.category_key], key: pi.key, name: pi.name, amount: pi.amount,
        currency: pi.currency, vat_included: true, billing_unit: "flat", status: "published", active: true,
        source_type: "hotel", published_at: new Date(nowIso()).toISOString(),
        pms_metadata: J({ needs_review: pi.needs_review, vat_rate: "unknown_from_source", source_legacy: pi.source_legacy }),
        legacy_airtable_record_id: pi.source_legacy,
      }, "price_items", "legacy_airtable_record_id");
    }

    // 15) ai_configs (single per hotel)
    const a = bundle.ai_config;
    await upsertByKey("ai_configs", ["hotel_id"], {
      hotel_id: hotelId, persona: J(a.persona), tone: a.tone, response_formatting: J(a.response_formatting),
      safe_handoff_text: a.safe_handoff_text, status: "published", active: true, published_at: new Date(nowIso()).toISOString(),
    }, "ai_configs");

    if (APPLY) {
      await q("commit");
      writeJson(join(MANIFEST_DIR, "legacy-id-map.json"), {
        importedAt: nowIso(), importVersion: IMPORT_VERSION, hotelSlug: HOTEL_SLUG, note: "legacy Airtable record id → Supabase uuid. No tokens.",
        map: idMap,
      });
    } else {
      await q("rollback");
    }

    const total = Object.values(stats).reduce((n, s) => n + s.created + s.updated, 0);
    console.log("  " + Object.entries(stats).map(([k, s]) => `${k}: +${s.created}~${s.updated}`).join("\n  "));
    console.log(`\n  ${MODE} complete — ${total} rows reconciled across ${Object.keys(stats).length} tables.`);
    console.log(APPLY ? "  COMMITTED to aiolly-dev. legacy-id-map.json written (no tokens)." : "  ROLLED BACK (dry-run). No writes persisted. Re-run with --apply to commit.");
  } catch (e) {
    await q("rollback").catch(() => {});
    console.error("  import error (rolled back):", e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error("fatal:", e.message); process.exit(1); });
