// AI OLLY — Hotel Presentation DEV SEED (aiolly-dev only).
// Ensures a small set of PUBLISHED canonical destination content exists in the
// demo hotels' destination ("Split (Dev)"), then seeds hotel presentation SETTINGS
// (hide / feature / recommendation / order / walking-time / intro) for the demo
// "Antique Split" hotel so the Presentation surface has data. Canonical rows are
// dev-only (keys prefixed presdev-); production Split destination is untouched.
// Idempotent. Keys from ../../.env.
import { readFileSync } from "node:fs"; import { fileURLToPath } from "node:url"; import { dirname, resolve } from "node:path";
import pg from "pg"; import { createClient } from "@supabase/supabase-js";
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => { const l = readFileSync(envPath, "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error(`Missing ${k}`); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const svc = createClient(readEnv("SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const sql = new pg.Client({ connectionString: readEnv("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });

const HOTEL_SLUG = "dash-antique-split";

async function publish(table, id) {
  const snap = (await sql.query(`update public.${table} set status='published', active=true, published_at=coalesce(published_at, now()) where id=$1 returning to_jsonb(${table}.*) - 'published_snapshot' s`, [id])).rows[0].s;
  await sql.query(`update public.${table} set published_snapshot=$2 where id=$1`, [id, snap]);
}
async function ensure(table, dest, key, fields) {
  const { data: ex } = await svc.from(table).select("id").eq("destination_id", dest).eq("key", key).maybeSingle();
  let id = ex?.id;
  if (id) { await svc.from(table).update(fields).eq("id", id); }
  else { const { data, error } = await svc.from(table).insert({ destination_id: dest, key, ...fields, status: "draft", active: true }).select("id").single(); if (error) throw error; id = data.id; }
  await publish(table, id);
  return id;
}
async function setSettings(table, idCol, hotelId, entityId, patch) {
  const { data: ex } = await svc.from(table).select("id").eq("hotel_id", hotelId).eq(idCol, entityId).maybeSingle();
  if (ex?.id) await svc.from(table).update(patch).eq("id", ex.id);
  else await svc.from(table).insert({ hotel_id: hotelId, [idCol]: entityId, ...patch });
}

async function main() {
  console.log("AI OLLY — Hotel Presentation dev seed\n"); await sql.connect();
  const { data: hotel } = await svc.from("hotels").select("id,name,destination_id").eq("slug", HOTEL_SLUG).maybeSingle();
  if (!hotel) { console.log(`  hotel ${HOTEL_SLUG} not found.`); await sql.end(); return; }
  const dest = hotel.destination_id;
  console.log(`  Hotel: ${hotel.name} → destination ${dest}. Production Split untouched.`);

  const poi1 = await ensure("destination_pois", dest, "presdev-poi-diocletian", { name: "Diocletian's Palace (Dev)", category: "landmark", short_description: "A 4th-century Roman palace at the heart of the old town.", address: "Old Town", latitude: 43.5081, longitude: 16.4402, sort_order: 1 });
  const poi2 = await ensure("destination_pois", dest, "presdev-poi-riva", { name: "The Riva promenade (Dev)", category: "landmark", short_description: "The palm-lined seafront promenade.", sort_order: 2 });
  await ensure("destination_pois", dest, "presdev-poi-marjan", { name: "Marjan Hill (Dev)", category: "nature", short_description: "A forested hill with viewpoints over the city.", sort_order: 3 });

  const route1 = await ensure("destination_routes", dest, "presdev-route-oldtown", { name: "Old Town walking loop (Dev)", short_description: "A gentle loop through the historic core.", difficulty: "easy", distance_km: 2.4, duration_minutes: 60, sort_order: 1, route_type: "walking" });
  await ensure("destination_routes", dest, "presdev-route-marjan", { name: "Marjan viewpoint hike (Dev)", short_description: "A climb to the best views in the city.", difficulty: "moderate", distance_km: 5.1, duration_minutes: 120, sort_order: 2, route_type: "walking" });

  const whi1 = await ensure("destination_whispers", dest, "presdev-whisper-origins", { channel_key: "story", title: "The city that grew inside a palace (Dev)", short_description: "How a retirement palace became a living city.", sort_order: 1 });
  await ensure("destination_whispers", dest, "presdev-whisper-sea", { channel_key: "story", title: "A life lived by the sea (Dev)", short_description: "The Riva and the rhythm of the coast.", sort_order: 2 });

  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 864e5).toISOString();
  const soonEnd = new Date(now.getTime() + 7 * 864e5 + 3 * 36e5).toISOString();
  const ev1 = await ensure("destination_events", dest, "presdev-event-summer", { title: "Split Summer Festival (Dev)", short_description: "Open-air concerts across the old town.", starts_at: soon, ends_at: soonEnd, all_day: false, location_name: "Peristyle", sort_order: 1 });
  await ensure("destination_events", dest, "presdev-event-market", { title: "Green Market morning (Dev)", short_description: "Local produce by the palace walls.", starts_at: soon, all_day: true, location_name: "Pazar", sort_order: 2 });

  // presentation settings for the demo hotel
  await setSettings("hotel_poi_settings", "poi_id", hotel.id, poi1, { featured: true, visible: true, sort_order_override: 1, walking_time_minutes: 6, hotel_recommendation: "Our guests’ favourite — start here, ten minutes on foot from reception.", hotel_short_description: "Step straight into 1,700 years of history." });
  await setSettings("hotel_poi_settings", "poi_id", hotel.id, poi2, { visible: false });
  await setSettings("hotel_route_settings", "route_id", hotel.id, route1, { featured: true, hotel_recommendation: "The perfect first-morning stroll.", walking_time_minutes: 3 });
  await setSettings("hotel_whisper_settings", "whisper_id", hotel.id, whi1, { hotel_recommendation: "Ask our concierge for the palace-cellars detail." });
  await setSettings("hotel_event_settings", "event_id", hotel.id, ev1, { featured: true, hotel_short_description: "We can arrange tickets at the desk." });

  console.log("  ✓ Seeded 3 POIs, 2 routes, 2 whispers, 2 events + presentation settings (1 hidden, 3 featured, recommendations).");
  await sql.end();
}
main().catch(async (e) => { console.error(e); try { await sql.end(); } catch {} process.exit(1); });
