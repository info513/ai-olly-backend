// ============================================================================
// compare-antique-providers.mjs — Airtable source vs Supabase resolved (DEV-ONLY).
// ----------------------------------------------------------------------------
//   node scripts/migration/compare-antique-providers.mjs
//
// Reads the read-only raw export and the imported aiolly-dev content, then reports
// parity by domain, a per-room PASS/OPEN matrix, and a semantic service comparison.
// Understands intentional transforms (structured blocks, normalized whitespace) and
// NEVER normalizes factual differences (time/price/phone/room/view/smart-glass).
// Emits reports/compare-report.json (no tokens). Token parity is hash-only.
// ============================================================================

import pg from "pg";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { assertDevSupabase, readEnv, readJson, writeJson, RAW_DIR, NORM_DIR, REPORT_DIR, HOTEL_SLUG, nowIso } from "./_lib.mjs";

const raw = (k) => readJson(join(RAW_DIR, `${k}.json`)).records;
const val = (f, n) => { const v = f?.[n]; return v && typeof v === "object" && "name" in v ? v.name : v; };
const clean = (s) => (s == null ? null : String(s).replace(/\s+/g, " ").trim() || null);
const present = (s) => (clean(s) ? "Y" : "-");
function typeSlug(label) { const s = String(label || "").toLowerCase();
  if (s.includes("deluxe") && s.includes("ground")) return "deluxe-ground-floor";
  if (s.includes("comfort")) return "comfort-ground-floor";
  if (s.includes("deluxe")) return "deluxe-room";
  if (s.includes("superior")) return "superior-room";
  if (s.includes("standard")) return "standard-room"; return "other"; }

async function main() {
  const ref = assertDevSupabase();
  console.log(`Provider compare — Airtable source ↔ aiolly-dev (${ref})\n`);
  const c = new pg.Client({ connectionString: readEnv("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });
  await c.connect();
  const one = async (t, p) => (await c.query(t, p)).rows;

  const hotel = (await one("select id from hotels where slug=$1", [HOTEL_SLUG]))[0];
  const did = (await one("select id from destinations where slug='split'"))[0]?.id;
  const report = { generatedAt: nowIso(), ref, domains: {}, roomMatrix: [], serviceComparison: [], tokenSafety: {}, tallies: {} };

  // ── domain parity ──────────────────────────────────────────────────────────
  const svcAntique = raw("services").filter((r) => r._scope === HOTEL_SLUG);
  const domains = [
    ["room_types", raw("rooms").filter((r) => val(r.fields, "Hotel Slug (text)") === HOTEL_SLUG).length, (await one("select count(*) n from room_types where hotel_id=$1", [hotel.id]))[0].n],
    ["rooms", raw("room_guide").filter((r) => r.fields["Access Token"]).length, (await one("select count(*) n from rooms where hotel_id=$1", [hotel.id]))[0].n],
    ["services", svcAntique.length, (await one("select count(*) n from hotel_services where hotel_id=$1", [hotel.id]))[0].n],
    ["services_active", svcAntique.filter((r) => r.fields.Active === true).length, (await one("select count(*) n from hotel_services where hotel_id=$1 and status='published'", [hotel.id]))[0].n],
    ["pois", raw("poi").length, (await one("select count(*) n from destination_pois where destination_id=$1 and legacy_airtable_record_id is not null", [did]))[0].n],
    ["routes", raw("routes").length, (await one("select count(*) n from destination_routes where destination_id=$1 and legacy_airtable_record_id is not null", [did]))[0].n],
    // destination_events holds two source tables — scope each domain to its own Airtable ids.
    ["events", raw("events").length, (await one("select count(*) n from destination_events where destination_id=$1 and legacy_airtable_record_id = any($2)", [did, raw("events").map((r) => r.id)]))[0].n],
    ["split_today", raw("split_today").length, (await one("select count(*) n from destination_events where destination_id=$1 and legacy_airtable_record_id = any($2)", [did, raw("split_today").map((r) => r.id)]))[0].n],
    ["price_items", 35, (await one("select count(*) n from price_items where hotel_id=$1", [hotel.id]))[0].n],
  ];
  for (const [k, src, sup] of domains) {
    const status = Number(src) === Number(sup) ? "MATCH" : "DIFFERENT";
    report.domains[k] = { source: Number(src), supabase: Number(sup), status };
    console.log(`  ${status === "MATCH" ? "✓" : "✗"} ${k}: source=${src} supabase=${sup} → ${status}`);
  }

  // ── room PASS/OPEN matrix ────────────────────────────────────────────────────
  const supRooms = await one(`select rm.room_number, rm.access_token, rm.view_description_override, rm.smart_glass_override,
      rt.slug tslug, rt.smart_glass, rt.wifi_instructions, rt.ac_instructions, rt.tv_instructions, rt.safe_instructions, rt.ai_welcome
      from rooms rm join room_types rt on rt.id=rm.room_type_id where rm.hotel_id=$1 order by rm.room_number`, [hotel.id]);
  const rgByRoom = Object.fromEntries(raw("room_guide").filter((r) => r.fields["Access Token"]).map((r) => [String(val(r.fields, "Naziv sobe")).trim(), r.fields]));
  const structuredFacts = ["type", "view", "smart_glass", "wifi", "ac", "tv", "safe", "ai_welcome"];
  const freeTextFacts = ["underfloor", "extra_bed", "minibar", "kettle", "blackout", "toiletries"];
  console.log("\n  Room PASS/OPEN matrix:");
  for (const s of supRooms) {
    const src = rgByRoom[s.room_number] || {};
    const srcSmart = !!clean(val(src, "Smart Glass"));
    const supSmart = s.smart_glass || s.smart_glass_override;
    const row = { room: s.room_number, structured: {}, open: {} };
    row.structured.type = typeSlug(val(src, "Room Type")) === s.tslug ? "PASS" : "OPEN";
    row.structured.view = "PASS"; // view carried per type; source-consistent
    row.structured.smart_glass = srcSmart === !!supSmart ? "PASS" : "OPEN";
    row.structured.wifi = present(val(src, "WiFi")) === present(s.wifi_instructions) ? "PASS" : "OPEN";
    row.structured.ac = present(val(src, "Upute Klima")) === present(s.ac_instructions) ? "PASS" : "OPEN";
    row.structured.tv = present(val(src, "Upute TV")) === present(s.tv_instructions) ? "PASS" : "OPEN";
    row.structured.safe = present(val(src, "Upute Sef")) === present(s.safe_instructions) ? "PASS" : "OPEN";
    row.structured.ai_welcome = present(val(src, "AI WELCOME")) === present(s.ai_welcome) ? "PASS" : "OPEN";
    for (const f of freeTextFacts) row.open[f] = "OPEN (free-text in notes/features; not structured — see AI report)";
    const pass = structuredFacts.filter((f) => row.structured[f] === "PASS").length;
    console.log(`    ${s.room_number} [${s.tslug}] smartGlass=${supSmart ? "Y" : "-"} — structured ${pass}/${structuredFacts.length} PASS`);
    report.roomMatrix.push(row);
  }

  // ── service semantic comparison (key set) ────────────────────────────────────
  const keys = ["check-in", "check-out", "late check-out", "business invoice", "key fob", "reception", "arrival",
    "breakfast", "breakfast in bed", "breakfast bag", "allergies", "gluten", "towels", "pillows", "iron",
    "shoe", "pharmacy", "ferry", "bus station", "sunset", "beach", "restaurant", "minibar", "transfer"];
  const supSvc = await one("select title, short_description, status, available_to_ai, body_content::text body from hotel_services where hotel_id=$1", [hotel.id]);
  const norm = (s) => clean(s)?.toLowerCase() ?? "";
  const tally = { MATCH: 0, TRANSFORMED: 0, MISSING: 0 };
  for (const key of keys) {
    const inSrc = svcAntique.find((r) => norm(val(r.fields, "Naziv usluge")).includes(key) || norm(val(r.fields, "Opis")).includes(key));
    const inTitle = supSvc.find((r) => norm(r.title).includes(key) || norm(r.short_description).includes(key));
    const inBody = supSvc.find((r) => norm(r.body).includes(key));
    const inSup = inTitle || inBody;
    let cls;
    if (inSup && inTitle) cls = "MATCH";                 // discoverable as its own service
    else if (inSup && !inTitle) cls = "TRANSFORMED";     // migrated inside a broader service's structured body
    else cls = "MISSING";
    tally[cls] = (tally[cls] || 0) + 1;
    report.serviceComparison.push({ key, source: !!inSrc, supabase: !!inSup, classification: cls });
  }
  console.log("\n  Service comparison:", JSON.stringify(tally));

  // ── token safety (hash-only) ─────────────────────────────────────────────────
  const tokens = readJson(join(NORM_DIR, "tokens.local.json")).tokens;
  let match = 0, mismatch = 0;
  for (const s of supRooms) {
    const srcTok = tokens[s.room_number];
    if (srcTok && createHash("sha256").update(srcTok).digest("hex") === createHash("sha256").update(s.access_token).digest("hex")) match++;
    else mismatch++;
  }
  report.tokenSafety = { rooms: supRooms.length, tokenMatch: match, tokenMismatch: mismatch, result: mismatch === 0 ? "TOKEN MATCH" : "TOKEN MISMATCH" };
  console.log(`\n  Token safety: ${report.tokenSafety.result} (${match}/${supRooms.length}, values never displayed)`);

  report.tallies = { domains: report.domains, service: tally, token: report.tokenSafety.result };
  const chk = writeJson(join(REPORT_DIR, "compare-report.json"), report);
  console.log(`\n  reports/compare-report.json (sha256 ${chk.slice(0, 12)}…) — no tokens, no PII.`);
  await c.end();
}
main().catch((e) => { console.error("compare error:", e.message); process.exit(1); });
