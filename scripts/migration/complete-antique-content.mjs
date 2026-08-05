// ============================================================================
// complete-antique-content.mjs — content-completion stage (idempotent, DEV-ONLY).
// ----------------------------------------------------------------------------
//   node scripts/migration/complete-antique-content.mjs [--apply]
//
// Populates the structured content the base import left in free text / unmapped,
// deriving STRICTLY from the read-only Airtable export (raw/) — no invention:
//   • room_types: minibar/kettle/blackout/underfloor/toiletries/window + extra-bed
//   • hotel_poi_settings.walking_time_minutes (from the distance band)
//   • destination_routes.waypoints (real POI links from the ROUTES `POIs` field)
//   • destination_events: Split Today city events (expired → archived)
//   • knowledge_categories + knowledge_articles (hotel deterministic facts) + aliases
//   • ai_configs: disambiguation + fallback + output rules (verbatim)
// Idempotent upserts/updates. assertDevSupabase(). Airtable is not contacted here.
// ============================================================================

import pg from "pg";
import { join } from "node:path";
import { assertDevSupabase, readEnv, readJson, RAW_DIR, NORM_DIR, HOTEL_SLUG, nowIso } from "./_lib.mjs";

const APPLY = process.argv.includes("--apply");
const raw = (k) => readJson(join(RAW_DIR, `${k}.json`)).records;
const val = (f, n) => { const x = f?.[n]; return x && typeof x === "object" && "name" in x ? x.name : x; };
const clean = (s) => (s == null ? null : String(s).replace(/\r\n/g, "\n").trim() || null);
const slug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 60);
const blocks = (t) => ({ version: 1, blocks: clean(t) ? [{ type: "paragraph", text: clean(t).replace(/\n+/g, " ") }] : [] });
function typeSlug(l) { const s = String(l || "").toLowerCase();
  if (s.includes("deluxe") && s.includes("ground")) return "deluxe-ground-floor";
  if (s.includes("comfort")) return "comfort-ground-floor";
  if (s.includes("deluxe")) return "deluxe-room";
  if (s.includes("superior")) return "superior-room";
  if (s.includes("standard")) return "standard-room"; return "other"; }

async function main() {
  const ref = assertDevSupabase();
  console.log(`Antique Split content completion → aiolly-dev (${ref}) — ${APPLY ? "APPLY" : "DRY-RUN"}\n`);
  const bundle = readJson(join(NORM_DIR, "antique-split.normalized.json"));
  const client = new pg.Client({ connectionString: readEnv("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });
  await client.connect();
  const q = (t, p) => client.query(t, p);
  const stats = {};
  const bump = (k, inserted) => { stats[k] ??= { created: 0, updated: 0 }; inserted ? stats[k].created++ : stats[k].updated++; };
  const J = (v) => JSON.stringify(v ?? null);

  try {
    await q("begin");
    const hotel = (await q("select id from hotels where slug=$1", [HOTEL_SLUG])).rows[0];
    if (!hotel) throw new Error("antique-split hotel not found — run the base import first.");
    const hid = hotel.id;
    const did = (await q("select id from destinations where slug='split'")).rows[0]?.id;

    // ── 1) Room type enrichment (aggregate structured facts across each type) ──
    const rg = raw("room_guide").filter((r) => r.fields["Access Token"]);
    const byType = new Map();
    for (const r of rg) {
      const f = r.fields, ts = typeSlug(val(f, "Room Type"));
      const blob = [val(f, "Napomene"), val(f, "Room features/Communication"), val(f, "AI WELCOME"), val(f, "Smart Glass")].filter(Boolean).join("\n");
      const winLine = blob.split("\n").map((l) => l.replace(/^[•\-\*\s]+/, "").trim()).find((l) => /window|prozor/i.test(l)) || null;
      const cur = byType.get(ts) || { minibar: false, kettle: false, blackout: false, underfloor: false, toiletries: null, window: null, extra: false };
      cur.minibar ||= /minibar|mini bar/i.test(blob);
      cur.kettle ||= /kettle|kuhalo/i.test(blob);
      cur.blackout ||= /blackout|black-?out/i.test(blob);
      cur.underfloor ||= /underfloor|podno grij/i.test(blob);
      cur.extra ||= /extra bed|dodatni krevet/i.test(blob);
      if (!cur.toiletries && /l.?occitane/i.test(blob)) cur.toiletries = "L'Occitane";
      if (!cur.window && winLine) cur.window = winLine;
      byType.set(ts, cur);
    }
    for (const [ts, x] of byType) {
      const r = await q(`update room_types set minibar_available=$2, kettle_available=$3, blackout_system=$4, underfloor_heating=$5,
        toiletries=coalesce($6, toiletries), window_instructions=coalesce($7, window_instructions), default_extra_bed_available=$8, updated_at=now()
        where hotel_id=$1 and slug=$9 returning id`, [hid, x.minibar, x.kettle, x.blackout, x.underfloor, x.toiletries, x.window, x.extra, ts]);
      if (r.rowCount) bump("room_types_enriched", false);
    }

    // ── 2) POI walking time (from distance band) ──────────────────────────────
    const bandMin = (b) => (b ? Number((/(\d+)\s*min\s*$/.exec(b) || /–\s*(\d+)/.exec(b) || [])[1]) || null : null);
    for (const r of raw("poi")) {
      const min = bandMin(val(r.fields, "Udaljenost od hotela"));
      if (min == null) continue;
      const up = await q(`update hotel_poi_settings s set walking_time_minutes=$3, updated_at=now()
        from destination_pois p where p.id=s.poi_id and s.hotel_id=$1 and p.legacy_airtable_record_id=$2 returning s.id`, [hid, r.id, min]);
      if (up.rowCount) bump("poi_walking_time", false);
    }

    // ── 3) Route → POI waypoints (real links from the ROUTES `POIs` field) ─────
    const poiKeyByRec = new Map((bundle.pois || []).map((p) => [p.legacy_airtable_record_id, p.key]));
    // map Airtable POI rec id → key: the normalized poi legacy id IS the Airtable rec id
    for (const r of raw("routes")) {
      const links = r.fields["POIs"] || [];
      if (!links.length) continue;
      const keys = links.map((rec) => poiKeyByRec.get(rec)).filter(Boolean);
      if (!keys.length) continue;
      const wp = { pois_linked: true, pois: keys, order: keys, order_text: clean(val(r.fields, "Redoslijed (AI koristi)")) ?? null };
      const up = await q(`update destination_routes set waypoints=$3, updated_at=now() where destination_id=$1 and legacy_airtable_record_id=$2 returning id`, [did, r.id, J(wp)]);
      if (up.rowCount) bump("route_waypoints", false);
    }

    // ── 4) Split Today → destination_events (expired → archived) ───────────────
    const today = nowIso().slice(0, 10);
    const seenEv = new Set();
    for (const r of raw("split_today")) {
      const f = r.fields, title = clean(val(f, "Naziv"));
      if (!title) continue;
      const start = clean(val(f, "Datum")), end = clean(val(f, "Datum kraj")) || start;
      const base = (slug(title).replace(/-+/g, "-").replace(/^-+|-+$/g, "")) || "event";
      let key = start ? `${base}-${start.replace(/[^0-9]/g, "")}` : base; // date as digits → always valid
      let nth = 2; const k0 = key; while (seenEv.has(key)) key = `${k0}-${nth++}`; seenEv.add(key);
      const status = end && end < today ? "archived" : "published";
      const ev = await q(`insert into destination_events (destination_id,key,title,short_description,body_content,starts_at,ends_at,all_day,location_name,status,active,sort_order,published_at,legacy_airtable_record_id)
        values ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,true,0,$10,$11)
        on conflict (destination_id,key) do update set title=excluded.title, short_description=excluded.short_description, body_content=excluded.body_content,
          starts_at=excluded.starts_at, ends_at=excluded.ends_at, location_name=excluded.location_name, status=excluded.status, legacy_airtable_record_id=excluded.legacy_airtable_record_id, updated_at=now()
        returning (xmax=0) inserted`,
        [did, key, title, clean(val(f, "Opis"))?.slice(0, 240) ?? null, J(blocks(val(f, "Opis"))), start ? `${start}T00:00:00Z` : null, end ? `${end}T00:00:00Z` : null,
          clean(val(f, "Lokacija")), status, new Date(nowIso()).toISOString(), r.id]);
      bump("split_today_events", ev.rows[0].inserted);
    }

    // ── 5) Knowledge: category + hotel deterministic-fact articles + aliases ───
    const hotelRow = raw("hotel").find((r) => val(r.fields, "Slug") === HOTEL_SLUG);
    const HF = hotelRow?.fields ?? {};
    const upCat = await q(`insert into knowledge_categories (hotel_id,key,name,sort_order,active) values ($1,'hotel-info','Hotel information',0,true)
      on conflict (hotel_id,key) where hotel_id is not null do update set name=excluded.name, updated_at=now() returning id, (xmax=0) inserted`, [hid]);
    const catId = upCat.rows[0].id; bump("knowledge_categories", upCat.rows[0].inserted);

    const phone = clean(val(HF, "Telefon (recepcija)")), mob = clean(val(HF, "Mobitel (recepcija)")), email = clean(val(HF, "Notification Email") || val(HF, "Email"));
    const wa = clean(val(HF, "WhatsApp")), emg = clean(val(HF, "Emergency Number")), med = clean(val(HF, "Medical Emergency Number"));
    const gmaps = clean(val(HF, "Google Maps")), grev = clean(val(HF, "Google Review"));
    const articles = [
      phone || mob ? { key: "contact-reception", title: "How do I contact reception?", critical: true,
        answer: `You can reach reception at ${[phone, mob].filter(Boolean).join(" or ")}${email ? ` (email ${email})` : ""}${wa ? `, or on WhatsApp ${wa}` : ""}.` } : null,
      emg ? { key: "emergency-number", title: "What is the emergency number?", critical: true, answer: `In an emergency, call ${emg}. Reception can also help — see the contact details.` } : null,
      med ? { key: "medical-emergency", title: "What is the medical emergency number?", critical: true, answer: `For a medical emergency, call ${med}.` } : null,
      val(HF, "Check-in") ? { key: "check-in-time", title: "What time is check-in?", critical: false, answer: `Check-in is from ${val(HF, "Check-in")}.` } : null,
      val(HF, "Check-out") ? { key: "check-out-time", title: "What time is check-out?", critical: false, answer: `Check-out is at ${val(HF, "Check-out")}.` } : null,
      (clean(val(HF, "Adresa")) || gmaps) ? { key: "hotel-address", title: "Where is the hotel / what is the address?", critical: false,
        answer: `${[clean(val(HF, "Adresa")), clean(val(HF, "Grad")), clean(val(HF, "Poštanski broj"))].filter(Boolean).join(", ")}${gmaps ? `. Map: ${gmaps}` : ""}.` } : null,
      grev ? { key: "leave-a-review", title: "How can I leave a review?", critical: false, answer: `We'd love your feedback — you can leave a review here: ${grev}.` } : null,
    ].filter(Boolean);

    const artIdByKey = new Map();
    for (const a of articles) {
      const r = await q(`insert into knowledge_articles (hotel_id,category_id,key,title,approved_answer,body_content,locale,status,active,available_to_ai,source_type,is_critical,priority,published_at,legacy_airtable_record_id)
        values ($1,$2,$3,$4,$5,$6,'en','published',true,true,'hotel',$7,$8,$9,$10)
        on conflict (hotel_id,locale,key) where hotel_id is not null do update set title=excluded.title, approved_answer=excluded.approved_answer, body_content=excluded.body_content,
          is_critical=excluded.is_critical, status='published', updated_at=now()
        returning id, (xmax=0) inserted`,
        [hid, catId, a.key, a.title, a.answer, J(blocks(a.answer)), a.critical, a.critical ? 10 : 5, new Date(nowIso()).toISOString(), hotelRow?.id ? `${hotelRow.id}:${a.key}` : a.key]);
      artIdByKey.set(a.key, r.rows[0].id); bump("knowledge_articles", r.rows[0].inserted);
    }

    // aliases: curate intent-pattern phrases that map to these hotel-fact articles (discard service-routing patterns)
    const artMatch = [
      { key: "contact-reception", re: /contact|phone|reception|recepcij|telefon|call|nazovi|broj/i },
      { key: "emergency-number", re: /emergency|hitno|112|police|policij/i },
      { key: "medical-emergency", re: /medical|ambulance|hitna|194|doctor|ljekar|lije[cč]/i },
      { key: "check-in-time", re: /check.?in|prijava|dolazak|arrival time|when can i check/i },
      { key: "check-out-time", re: /check.?out|odjava|odlazak|departure time|late check/i },
      { key: "hotel-address", re: /address|adresa|where is|lokacij|how to reach|kako do[cć]/i },
    ];
    const seenAlias = new Set();
    for (const r of raw("ai_intent")) {
      const f = r.fields, intent = clean(val(f, "Intent")) || "", phrases = clean(f["Phrases"]) || "";
      const hay = `${intent} ${phrases}`;
      const m = artMatch.find((x) => x.re.test(hay));
      if (!m || !artIdByKey.has(m.key)) continue;
      const lines = phrases.split("\n").map((l) => l.trim()).filter((l) => l.length > 1).slice(0, 8);
      for (const line of lines) {
        const norm = line.toLowerCase().replace(/\s+/g, " ").slice(0, 120);
        const dk = m.key + "|" + norm;
        if (seenAlias.has(dk)) continue; seenAlias.add(dk);
        const ins = await q(`insert into knowledge_aliases (hotel_id,article_id,intent_key,locale,alias_text,active)
          values ($1,$2,$3,'en',$4,true)
          on conflict (coalesce(hotel_id,'00000000-0000-0000-0000-000000000000'::uuid),locale,normalized_alias) do nothing returning id`,
          [hid, artIdByKey.get(m.key), slug(intent), line.slice(0, 200)]);
        if (ins.rowCount) bump("knowledge_aliases", true);
      }
    }

    // ── 6) ai_configs: fold in disambiguation + fallback + output rules (verbatim) ─
    const disamb = raw("ai_disambig").filter((r) => clean(val(r.fields, "Scenario"))).map((r) => ({ scenario: val(r.fields, "Scenario"), response: clean(val(r.fields, "AI Response")) }));
    const fallback = raw("ai_fallback").filter((r) => clean(val(r.fields, "Scenario"))).map((r) => ({ scenario: val(r.fields, "Scenario"), response: clean(val(r.fields, "AI Response")) }));
    const outputRules = raw("ai_output_rules").filter((r) => r.fields.Active !== false).map((r) => ({ scope: val(r.fields, "Scope"), format: val(r.fields, "Format"), style: clean(val(r.fields, "Style")) }));
    const existing = (await q("select response_formatting from ai_configs where hotel_id=$1", [hid])).rows[0]?.response_formatting ?? {};
    const merged = { ...(typeof existing === "object" ? existing : {}), output_rules: outputRules, disambiguation: disamb, fallback };
    const upc = await q("update ai_configs set response_formatting=$2, updated_at=now() where hotel_id=$1 returning id", [hid, J(merged)]);
    if (upc.rowCount) bump("ai_config_extended", false);

    if (APPLY) await q("commit"); else await q("rollback");

    console.log("  " + Object.entries(stats).map(([k, s]) => `${k}: +${s.created}~${s.updated}`).join("\n  "));
    console.log(`\n  ${APPLY ? "COMMITTED to aiolly-dev." : "ROLLED BACK (dry-run). Re-run with --apply."}`);
    console.log("  Note: extra-bed/transfer/breakfast/room-service prices are NOT in Airtable (no € in source) — not structured (no invention).");
    console.log("  Note: Whispers are not an Airtable table (static in v1 PWA) — nothing to migrate from source.");
  } catch (e) {
    await q("rollback").catch(() => {});
    console.error("  completion error (rolled back):", e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error("fatal:", e.message); process.exit(1); });
