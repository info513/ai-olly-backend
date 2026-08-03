// ============================================================================
// AI OLLY Dashboard — DEV content seed (aiolly-dev only).
// ----------------------------------------------------------------------------
// Populates the synthetic Demo Hotel (dash-demo-hotel) with enough SYNTHETIC
// content to demonstrate Sprint 3: room-type inheritance, room overrides
// (Smart Glass true/false/inherit), platform-default + hotel-owned service
// categories, services (draft / published / platform-default / hotel-override /
// critical), and one content version for History. Idempotent. Reads the
// service-role key from ../../.env at runtime (never embedded). No production,
// no Antique Split content, no real tokens/guests.
//
//   node dashboard/scripts/setup-dev-content.mjs
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
const readEnv = (k) => {
  const line = readFileSync(envPath, "utf8").split("\n").find((l) => l.startsWith(k + "="));
  if (!line) throw new Error(`Missing ${k} in ${envPath}`);
  return line.slice(k.length + 1).trim().replace(/^["']|["']$/g, "");
};
const svc = createClient(readEnv("SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const BODY = (t) => ({ version: 1, blocks: [{ type: "paragraph", text: t }] });

async function hotelId(slug) {
  const { data } = await svc.from("hotels").select("id").eq("slug", slug).maybeSingle();
  if (!data) throw new Error(`hotel ${slug} not found — run setup-dev-user.mjs first`);
  return data.id;
}
async function upsert(table, match, row) {
  let q = svc.from(table).select("id");
  for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
  const found = await q.maybeSingle();
  if (found.data?.id) {
    await svc.from(table).update(row).eq("id", found.data.id);
    return found.data.id;
  }
  const ins = await svc.from(table).insert({ ...match, ...row }).select("id").single();
  if (ins.error) throw new Error(`${table}: ${ins.error.message}`);
  return ins.data.id;
}

async function main() {
  console.log("AI OLLY dashboard content seed →", readEnv("SUPABASE_URL"), "\n");
  const demo = await hotelId("dash-demo-hotel");

  // ── Room types ────────────────────────────────────────────────────────────
  const deluxe = await upsert("room_types", { hotel_id: demo, slug: "deluxe" }, {
    name: "Deluxe", description: "Spacious sea-facing rooms with smart glass.", active: true, sort_order: 10,
    default_capacity: 2, default_bed_configuration: "King-size bed",
    wifi_instructions: "Network AIOLLY-DEMO, password at reception.",
    ac_instructions: "Use the wall panel; eco mode saves energy.",
    tv_instructions: "Smart TV — press Home for streaming apps.",
    safe_instructions: "In the wardrobe; set a 4-digit code.",
    smart_glass: true, smart_glass_instructions: "Tap the switch by the window to frost the glass.",
    window_instructions: "Windows open inward; handle turns up to tilt.",
    underfloor_heating: true, room_features: ["King-size bed", "Sea view", "Minibar", "Smart glass"],
    room_notes: ["Quietest rooms on the top floor."], ai_welcome: "Welcome to your Deluxe room — enjoy the sea view.",
    minibar_available: true, kettle_available: true, blackout_system: true, toiletries: "Organic olive-oil range.",
  });
  const standard = await upsert("room_types", { hotel_id: demo, slug: "standard" }, {
    name: "Standard", description: "Comfortable courtyard rooms.", active: true, sort_order: 20,
    default_capacity: 2, default_bed_configuration: "Queen-size bed",
    wifi_instructions: "Network AIOLLY-DEMO, password at reception.",
    ac_instructions: "Wall panel controls temperature.", tv_instructions: "Standard TV with local channels.",
    safe_instructions: "In the wardrobe.", smart_glass: false, underfloor_heating: false,
    window_instructions: "Windows open inward.", room_features: ["Queen-size bed", "Courtyard view"],
    ai_welcome: "Welcome to your Standard room.", minibar_available: false, kettle_available: true,
    blackout_system: false, toiletries: "Standard amenities.",
  });
  console.log("  ✓ room types: Deluxe, Standard");

  // ── Rooms (inheritance + overrides incl. Smart Glass true/false/inherit) ────
  const mkRoom = (num, typeId, extra) => upsert("rooms", { hotel_id: demo, room_number: num }, {
    room_type_id: typeId, access_token: `DEMO-${demo.slice(0, 6)}-${num}`, active: true, ...extra,
  });
  await mkRoom("101", deluxe, { floor: 1 });                                                    // inherits all
  await mkRoom("102", deluxe, { floor: 1, smart_glass_override: false, view_description_override: "Sea view over the promenade" }); // true -> false
  await mkRoom("103", deluxe, { floor: 1, smart_glass_override: true, ai_welcome_override: "Welcome to our finest Deluxe corner room." }); // explicit true
  await mkRoom("201", standard, { floor: 2 });                                                  // inherits (smart_glass false)
  await mkRoom("202", standard, { floor: 2, smart_glass_override: true, capacity_override: 3 }); // false -> true + capacity
  console.log("  ✓ rooms: 101 (inherit), 102 (glass off + view), 103 (glass on), 201 (inherit), 202 (glass on)");

  // ── Service categories (platform defaults + one hotel-owned) ────────────────
  const cats = {};
  for (const [key, name, sort] of [
    ["arrival-departure", "Arrival & Departure", 10],
    ["guest-services", "Guest Services", 20],
    ["breakfast-food", "Breakfast & Food", 30],
    ["transport-parking", "Transport & Parking", 40],
    ["policies-safety", "Policies & Safety", 50],
  ]) cats[key] = await upsert("service_categories", { hotel_id: null, key }, { name, sort_order: sort, active: true });
  cats["demo-extras"] = await upsert("service_categories", { hotel_id: demo, key: "demo-extras" }, { name: "Demo Extras", sort_order: 60, active: true });
  console.log("  ✓ categories: 5 platform defaults + 1 hotel-owned");

  // ── Services ────────────────────────────────────────────────────────────────
  const platCheckin = await upsert("hotel_services", { hotel_id: null, key: "check-in-out" }, {
    category_id: cats["policies-safety"], title: "Check-in & Check-out",
    short_description: "Standard arrival and departure times.",
    body_content: { version: 1, blocks: [{ type: "paragraph", text: "Check-in from 15:00. Check-out by 11:00." }, { type: "callout", style: "info", text: "Late check-out on request, subject to availability." }] },
    status: "published", active: true, is_critical: true, visible_in_pwa: true, visible_in_web: true, available_to_ai: true,
    sort_order: 10, published_at: new Date().toISOString(),
  });
  const override = await upsert("hotel_services", { hotel_id: demo, key: "check-in-out" }, {
    category_id: cats["policies-safety"], title: "Check-in & Check-out",
    short_description: "Demo Hotel arrival and departure times.",
    body_content: { version: 1, blocks: [{ type: "paragraph", text: "Check-in from 14:00. Check-out by 10:30." }, { type: "contact_action", action: "call", value: "+385000000000", label: "Call reception" }] },
    status: "published", active: true, is_critical: true, visible_in_pwa: true, visible_in_web: true, available_to_ai: true,
    sort_order: 10, override_of_service_id: platCheckin, published_at: new Date().toISOString(), last_critical_ack_at: new Date().toISOString(),
  });
  await upsert("hotel_services", { hotel_id: demo, key: "airport-transfer" }, {
    category_id: cats["transport-parking"], title: "Airport Transfer",
    body_content: { version: 1, blocks: [{ type: "paragraph", text: "Private airport transfer available on request." }, { type: "price_list", items: [{ label: "One way", price: "€45" }] }] },
    status: "published", active: true, visible_in_pwa: true, visible_in_web: false, available_to_ai: true,
    sort_order: 20, published_at: new Date().toISOString(),
  });
  await upsert("hotel_services", { hotel_id: demo, key: "breakfast-hours" }, {
    category_id: cats["breakfast-food"], title: "Breakfast Hours",
    body_content: BODY("Breakfast 07:00–10:30 in the summer season."), status: "published", active: true,
    visible_in_pwa: true, visible_in_web: false, available_to_ai: true, sort_order: 30,
    valid_from: new Date(Date.now() - 10 * 864e5).toISOString(), valid_to: new Date(Date.now() + 80 * 864e5).toISOString(),
    published_at: new Date().toISOString(),
  });
  await upsert("hotel_services", { hotel_id: demo, key: "spa-hours" }, {
    category_id: cats["guest-services"], title: "Spa & Wellness Hours",
    body_content: BODY("Draft — spa opening hours to be confirmed."), status: "draft", active: true,
    visible_in_pwa: true, visible_in_web: false, available_to_ai: true, sort_order: 40,
  });
  console.log("  ✓ services: platform check-in, hotel override (critical), transfer, breakfast (dated), spa (draft)");

  // ── One content version for History (direct insert; append-only) ────────────
  const existingV = await svc.from("content_versions").select("id").eq("entity_type", "hotel_service").eq("entity_id", override).eq("version_number", 1).maybeSingle();
  if (!existingV.data) {
    const snap = (await svc.from("hotel_services").select("*").eq("id", override).single()).data;
    await svc.from("content_versions").insert({
      entity_type: "hotel_service", entity_id: override, version_number: 1, status: "published",
      snapshot: snap, change_summary: "Initial publish (seed).", hotel_id: demo, published_at: new Date().toISOString(),
    });
    console.log("  ✓ seeded content version v1 for the override service");
  } else {
    console.log("  ✓ content version already present");
  }

  console.log("\n  Done. Sign in and open Content → Rooms / Services.\n");
}

main().catch((e) => { console.error("  seed error:", e.message); process.exit(1); });
