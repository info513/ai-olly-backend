// ============================================================================
// Guest PWA content layer (Session 3) — the NEW "brain" for the guest app's
// content endpoints, reading Supabase instead of Airtable. Response shapes are a
// 1:1 match of the old Express endpoints (server/server.js) so the existing PWA
// frontend (pwa/) works UNCHANGED. Server-only: uses a direct Postgres connection
// (service-role via SUPABASE_DB_URL) and the resolved_* / hotel-scoped functions,
// exactly like the dashboard. Token auth mirrors the old timing-safe room-token check.
// ============================================================================
import pg from "pg";
import { timingSafeEqual } from "node:crypto";

function client() {
  const conn = process.env.SUPABASE_DB_URL;
  if (!conn) { const e = new Error("SUPABASE_DB_URL not configured."); e.status = 500; throw e; }
  return new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
}
async function withDb(fn) { const db = client(); await db.connect(); try { return await fn(db); } finally { await db.end(); } }

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
async function authGuest(db, slug, roomNumber, token) {
  const hotel = (await db.query(`select id, name, slug, settings from public.hotels where slug=$1`, [slug])).rows[0];
  if (!hotel) return null;
  const room = (await db.query(
    `select * from public.rooms where hotel_id=$1 and room_number=$2 and active`, [hotel.id, String(roomNumber)])).rows[0];
  if (!room) return null;
  if (!tokenOk(token, room.access_token)) return null;
  const roomType = room.room_type_id
    ? (await db.query(`select * from public.room_types where id=$1`, [room.room_type_id])).rows[0] : null;
  return { hotel, room, roomType };
}

const DENIED = { status: 403, body: { ok: false, error: "Access denied" } };
const NOROOM = { status: 400, body: { ok: false, error: "Missing room" } };

// ── endpoints (each returns { status, body }) ────────────────────────────────

/** POST /api/pwa-welcome → { ok, hotelName, roomType, aiWelcome, googleReviewUrl } */
export function welcome({ slug, room, token }) {
  if (!room) return Promise.resolve(NOROOM);
  return withDb(async (db) => {
    const ctx = await authGuest(db, slug, room, token);
    if (!ctx) return DENIED;
    const { hotel, room: rm, roomType: rt } = ctx;
    return { status: 200, body: {
      ok: true,
      hotelName: hotel.name ?? "",
      roomType: rt?.name ?? "",
      aiWelcome: rm.ai_welcome_override ?? rt?.ai_welcome ?? "",
      googleReviewUrl: hotel.settings?.google_review ?? "",
    } };
  });
}

/** POST /api/pwa-room-guide → { ok, wifi, klimaUpute, tvUpute, sefUpute, roomFeatures, smartGlass, napomene, aiWelcome } */
export function roomGuide({ slug, room, token }) {
  if (!room) return Promise.resolve(NOROOM);
  return withDb(async (db) => {
    const ctx = await authGuest(db, slug, room, token);
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
  });
}

/** POST /api/pwa-services → { ok, services:[{ id, naziv, opis, radnoVrijeme, kategorija[], aiIntent[] }] } */
export function services({ slug, room, token }) {
  if (!room) return Promise.resolve(NOROOM);
  return withDb(async (db) => {
    const ctx = await authGuest(db, slug, room, token);
    if (!ctx) return DENIED;
    const rows = (await db.query(
      `select * from public.resolved_hotel_services($1) where visible_in_pwa order by sort_order nulls last, title`, [ctx.hotel.id])).rows;
    const list = rows.map((s) => ({
      id: s.service_id,
      naziv: s.title ?? "",
      opis: blocksToText(s.body_content) || (s.short_description ?? ""),
      radnoVrijeme: "", // old Airtable "radno vrijeme" has no distinct column yet — see docs/known-gaps
      kategorija: s.category_name ? [s.category_name] : [],
      aiIntent: [], // AI intent aliases not surfaced to the content API (used by the ask engine in S4)
    }));
    return { status: 200, body: { ok: true, services: list } };
  });
}

/** POST /api/pwa-pois → { ok, pois:[{ id, name, category, city, shortDesc, longDesc, visit, dist, coords, nav, alwaysOn, sortOrder }] } */
export function pois({ slug, room, token }) {
  if (!room) return Promise.resolve(NOROOM);
  return withDb(async (db) => {
    const ctx = await authGuest(db, slug, room, token);
    if (!ctx) return DENIED;
    const rows = (await db.query(`select * from public.resolved_destination_pois($1) order by sort_order nulls last, name`, [ctx.hotel.id])).rows;
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
  });
}

/** POST /api/pwa-routes → { ok, routes:[{ id, name, type, duration, shortDesc, longDesc, startPointName, startPointCoords, poiIds, profile }] } */
export function routes({ slug, room, token }) {
  if (!room) return Promise.resolve(NOROOM);
  return withDb(async (db) => {
    const ctx = await authGuest(db, slug, room, token);
    if (!ctx) return DENIED;
    const rows = (await db.query(`select * from public.resolved_destination_routes($1) order by sort_order nulls last, name`, [ctx.hotel.id])).rows;
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
  });
}

/** POST /api/pwa-partners → { ok, partners:[] } (no partners table in Supabase yet — see docs/known-gaps) */
export function partners() {
  return Promise.resolve({ status: 200, body: { ok: true, partners: [], meta: { count: 0 } } });
}

/** POST /api/pwa-events → { ok, events:[{ id, name, date, description, link, tip }] } (hotel/local events, not live-feed) */
export function events({ slug }) {
  const hotelSlug = slug || "antique-split";
  return withDb(async (db) => {
    const hotel = (await db.query(`select id from public.hotels where slug=$1`, [hotelSlug])).rows[0];
    if (!hotel) return { status: 200, body: { ok: true, events: [] } };
    const liveIds = new Set((await db.query(`select id from public.destination_events where is_live_feed`)).rows.map((r) => r.id));
    const today = dateOnly(new Date());
    const rows = (await db.query(`select * from public.resolved_destination_events($1)`, [hotel.id])).rows;
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
  });
}

/** GET /api/pwa-split-today-events → { ok, today:[], thisWeek:[], upcoming:[] } (city live-feed events, Europe/Zagreb) */
export function splitToday({ slug } = {}) {
  const hotelSlug = slug || "antique-split";
  return withDb(async (db) => {
    const hotel = (await db.query(`select id from public.hotels where slug=$1`, [hotelSlug])).rows[0];
    if (!hotel) return { status: 200, body: { ok: true, today: [], thisWeek: [], upcoming: [] } };
    const liveIds = new Set((await db.query(`select id from public.destination_events where is_live_feed`)).rows.map((r) => r.id));
    const zagreb = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Zagreb" }));
    const todayStr = zagreb.toISOString().slice(0, 10);
    const weekEnd = new Date(zagreb); weekEnd.setDate(zagreb.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);
    const rows = (await db.query(`select * from public.resolved_destination_events($1)`, [hotel.id])).rows
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
  });
}
