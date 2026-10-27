// ============================================================================
// Guest PWA content layer (Session 3) — the NEW "brain" for the guest app's
// content endpoints, reading Supabase instead of Airtable. Response shapes are a
// 1:1 match of the old Express endpoints (server/server.js) so the existing PWA
// frontend (pwa/) works UNCHANGED. Server-only: uses supabase-js with the
// SERVICE-ROLE key over HTTPS (serverless-native on Vercel — no DB pool/port) and
// the resolved_* functions, exactly like the dashboard. Token auth mirrors the old
// timing-safe room-token check.
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { const e = new Error("Supabase env not configured."); e.status = 500; throw e; }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function unwrap(res, what) {
  if (res.error) { const e = new Error(`${what}: ${res.error.message}`); e.status = 500; throw e; }
  return res.data;
}

// ── shaping helpers ─────────────────────────────────────────────────────────
/** Flatten a {blocks:[{text,type}]} body (or string) to plain text. */
function blocksToText(bc) {
  if (!bc) return "";
  if (typeof bc === "string") return bc;
  const blocks = Array.isArray(bc) ? bc : (bc.blocks || []);
  return blocks.map((b) => (b && (b.text ?? b.content ?? "")) || "").filter(Boolean).join("\n\n");
}
/** Coerce text|array|blocks into a display string. */
function asText(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.filter(Boolean).join("\n");
  if (typeof v === "object") return blocksToText(v);
  return String(v);
}
const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
function mapsUrl(name, lat, lng) {
  if (lat != null && lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  return name ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ", Split")}` : "";
}

/** Timing-safe compare of the QR token against the stored room access_token. */
function tokenOk(provided, stored) {
  if (!provided || !stored) return false;
  const a = Buffer.from(String(provided)), b = Buffer.from(String(stored));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Resolve hotel + room + room-type and validate the token. Returns ctx or null (→403). */
async function authGuest(client, slug, roomNumber, token) {
  const hotel = unwrap(await client.from("hotels").select("id,name,slug,settings").eq("slug", slug).maybeSingle(), "hotel");
  if (!hotel) return null;
  const room = unwrap(await client.from("rooms").select("*").eq("hotel_id", hotel.id).eq("room_number", String(roomNumber)).eq("active", true).maybeSingle(), "room");
  if (!room) return null;
  if (!tokenOk(token, room.access_token)) return null;
  const roomType = room.room_type_id
    ? unwrap(await client.from("room_types").select("*").eq("id", room.room_type_id).maybeSingle(), "room_type") : null;
  return { hotel, room, roomType };
}

const DENIED = { status: 403, body: { ok: false, error: "Access denied" } };
const NOROOM = { status: 400, body: { ok: false, error: "Missing room" } };

// ── endpoints (each returns { status, body }) ────────────────────────────────

/** POST /api/pwa-welcome → { ok, hotelName, roomType, aiWelcome, googleReviewUrl } */
export async function welcome({ slug, room, token }) {
  if (!room) return NOROOM;
  const ctx = await authGuest(sb(), slug, room, token);
  if (!ctx) return DENIED;
  const { hotel, room: rm, roomType: rt } = ctx;
  return { status: 200, body: {
    ok: true,
    hotelName: hotel.name ?? "",
    roomType: rt?.name ?? "",
    aiWelcome: rm.ai_welcome_override ?? rt?.ai_welcome ?? "",
    googleReviewUrl: hotel.settings?.google_review ?? "",
  } };
}

/** POST /api/pwa-room-guide → { ok, wifi, klimaUpute, tvUpute, sefUpute, roomFeatures, smartGlass, napomene, aiWelcome } */
export async function roomGuide({ slug, room, token }) {
  if (!room) return NOROOM;
  const ctx = await authGuest(sb(), slug, room, token);
  if (!ctx) return DENIED;
  const { room: rm, roomType: rt } = ctx;
  return { status: 200, body: {
    ok: true,
    wifi: rt?.wifi_instructions ?? "",
    klimaUpute: rm.air_conditioning_note_override ?? rt?.ac_instructions ?? "",
    tvUpute: rt?.tv_instructions ?? "",
    sefUpute: rt?.safe_instructions ?? "",
    roomFeatures: asText(rm.room_features_override ?? rt?.room_features),
    smartGlass: rm.smart_glass_instructions_override ?? rt?.smart_glass_instructions ?? "",
    napomene: asText(rm.room_notes_override ?? rt?.room_notes),
    aiWelcome: rm.ai_welcome_override ?? rt?.ai_welcome ?? "",
  } };
}

/** POST /api/pwa-services → { ok, services:[{ id, naziv, opis, radnoVrijeme, kategorija[], aiIntent[] }] } */
export async function services({ slug, room, token }) {
  if (!room) return NOROOM;
  const client = sb();
  const ctx = await authGuest(client, slug, room, token);
  if (!ctx) return DENIED;
  const rows = (unwrap(await client.rpc("resolved_hotel_services", { p_hotel: ctx.hotel.id }), "services") || [])
    .filter((s) => s.visible_in_pwa)
    .sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || String(a.title).localeCompare(String(b.title)));
  const list = rows.map((s) => ({
    id: s.service_id,
    naziv: s.title ?? "",
    opis: blocksToText(s.body_content) || (s.short_description ?? ""),
    radnoVrijeme: "", // old Airtable "radno vrijeme" has no distinct column yet — see known gaps
    kategorija: s.category_name ? [s.category_name] : [],
    aiIntent: [], // AI intent aliases are used by the ask engine (S4), not the content API
  }));
  return { status: 200, body: { ok: true, services: list } };
}

/** POST /api/pwa-pois → { ok, pois:[{ id, name, category, city, shortDesc, longDesc, visit, dist, coords, nav, alwaysOn, sortOrder }] } */
export async function pois({ slug, room, token }) {
  if (!room) return NOROOM;
  const client = sb();
  const ctx = await authGuest(client, slug, room, token);
  if (!ctx) return DENIED;
  const rows = (unwrap(await client.rpc("resolved_destination_pois", { p_hotel: ctx.hotel.id }), "pois") || [])
    .sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || String(a.name).localeCompare(String(b.name)));
  const list = rows.map((p) => {
    const lat = p.latitude != null ? Number(p.latitude) : null;
    const lng = p.longitude != null ? Number(p.longitude) : null;
    return {
      id: p.poi_id, name: p.name ?? "", category: p.category ?? "", city: "Split",
      shortDesc: p.hotel_short_description || p.short_description || "",
      longDesc: blocksToText(p.body_content),
      visit: "",
      dist: p.walking_time_minutes != null ? `${p.walking_time_minutes} min walk` : "",
      coords: lat != null && lng != null ? { lat, lng } : null,
      nav: mapsUrl(p.name, lat, lng),
      alwaysOn: false,
      sortOrder: p.sort_order ?? 0,
    };
  });
  return { status: 200, body: { ok: true, pois: list } };
}

/** POST /api/pwa-routes → { ok, routes:[{ id, name, type, duration, shortDesc, longDesc, startPointName, startPointCoords, poiIds, profile }] } */
export async function routes({ slug, room, token }) {
  if (!room) return NOROOM;
  const client = sb();
  const ctx = await authGuest(client, slug, room, token);
  if (!ctx) return DENIED;
  const rows = (unwrap(await client.rpc("resolved_destination_routes", { p_hotel: ctx.hotel.id }), "routes") || [])
    .sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || String(a.name).localeCompare(String(b.name)));
  const list = rows.map((r) => ({
    id: r.route_id, name: r.name ?? "",
    type: r.difficulty ?? "",
    duration: r.duration_minutes != null ? String(r.duration_minutes) : "",
    shortDesc: r.hotel_short_description || r.short_description || "",
    longDesc: blocksToText(r.body_content),
    startPointName: "",
    startPointCoords: null,
    poiIds: (r.waypoints && Array.isArray(r.waypoints.pois)) ? r.waypoints.pois : [],
    profile: "",
  }));
  return { status: 200, body: { ok: true, routes: list } };
}

/** POST /api/pwa-partners → { ok, partners:[] } (no partners table in Supabase yet — see known gaps) */
export async function partners() {
  return { status: 200, body: { ok: true, partners: [], meta: { count: 0 } } };
}

/** POST /api/pwa-events → { ok, events:[{ id, name, date, description, link, tip }] } (hotel/local events, not live-feed) */
export async function events({ slug }) {
  const hotelSlug = slug || "antique-split";
  const client = sb();
  const hotel = unwrap(await client.from("hotels").select("id").eq("slug", hotelSlug).maybeSingle(), "hotel");
  if (!hotel) return { status: 200, body: { ok: true, events: [] } };
  const liveIds = new Set((unwrap(await client.from("destination_events").select("id").eq("is_live_feed", true), "live") || []).map((r) => r.id));
  const today = dateOnly(new Date());
  const rows = unwrap(await client.rpc("resolved_destination_events", { p_hotel: hotel.id }), "events") || [];
  const list = rows
    .filter((e) => !liveIds.has(e.event_id))
    .filter((e) => e.all_day || !e.starts_at || dateOnly(e.starts_at) >= today)
    .sort((a, b) => String(a.starts_at ?? "").localeCompare(String(b.starts_at ?? "")))
    .map((e) => ({
      id: e.event_id, name: e.title ?? "", date: dateOnly(e.starts_at),
      description: e.short_description || blocksToText(e.body_content), link: "",
      tip: e.all_day ? "Always on" : "Event",
    }));
  return { status: 200, body: { ok: true, events: list } };
}

/** GET /api/pwa-split-today-events → { ok, today:[], thisWeek:[], upcoming:[] } (city live-feed events, Europe/Zagreb) */
export async function splitToday({ slug } = {}) {
  const hotelSlug = slug || "antique-split";
  const client = sb();
  const hotel = unwrap(await client.from("hotels").select("id").eq("slug", hotelSlug).maybeSingle(), "hotel");
  if (!hotel) return { status: 200, body: { ok: true, today: [], thisWeek: [], upcoming: [] } };
  const liveIds = new Set((unwrap(await client.from("destination_events").select("id").eq("is_live_feed", true), "live") || []).map((r) => r.id));
  const zagreb = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Zagreb" }));
  const todayStr = zagreb.toISOString().slice(0, 10);
  const weekEnd = new Date(zagreb); weekEnd.setDate(zagreb.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);
  const rows = (unwrap(await client.rpc("resolved_destination_events", { p_hotel: hotel.id }), "events") || [])
    .filter((e) => liveIds.has(e.event_id));
  const map = (e) => ({
    id: e.event_id, name: e.title ?? "", date: dateOnly(e.starts_at), endDate: dateOnly(e.ends_at),
    time: !e.all_day && e.starts_at ? new Date(e.starts_at).toISOString().slice(11, 16) : "",
    location: e.location_name ?? "", category: "",
    description: e.short_description || blocksToText(e.body_content), link: "",
  });
  const current = rows.filter((e) => {
    const d = dateOnly(e.starts_at), end = dateOnly(e.ends_at);
    return d >= todayStr || (end && end >= todayStr);
  }).sort((a, b) => String(a.starts_at ?? "").localeCompare(String(b.starts_at ?? "")));
  const today = [], thisWeek = [], upcoming = [];
  for (const e of current) {
    const d = dateOnly(e.starts_at);
    if (d === todayStr) today.push(map(e));
    else if (d > todayStr && d <= weekEndStr) thisWeek.push(map(e));
    else upcoming.push(map(e));
  }
  return { status: 200, body: { ok: true, today, thisWeek, upcoming } };
}
