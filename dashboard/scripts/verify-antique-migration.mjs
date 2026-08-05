// ============================================================================
// verify-antique-migration.mjs — automated checks for the Antique Split DEV import.
// ----------------------------------------------------------------------------
//   node dashboard/scripts/verify-antique-migration.mjs
// Non-destructive. Asserts the import is present, correct, idempotent, token-safe,
// and scoped. Reads SUPABASE_DB_URL from ../../.env. Never prints token values.
// ============================================================================

import pg from "pg";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../..");
const MIG = join(REPO, "migration", "antique-split");
const readEnv = (k) => { const l = readFileSync(join(REPO, ".env"), "utf8").split("\n").find((x) => x.startsWith(k + "=")); if (!l) throw new Error("missing " + k); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
const DEV_REF = "mcgrccvvybgcozeqlisj";
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };
const eq = (a, b, m) => (Number(a) === Number(b) ? ok(`${m} (${a})`) : bad(`${m}: expected ${b}, got ${a}`));

async function main() {
  console.log("Antique Split migration verification (aiolly-dev)\n");
  const ref = /https?:\/\/([a-z0-9]+)\./.exec(readEnv("SUPABASE_URL"))?.[1];
  ref === DEV_REF ? ok(`target is aiolly-dev (${ref})`) : bad(`target ref ${ref} is not DEV`);

  const c = new pg.Client({ connectionString: readEnv("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });
  await c.connect();
  const rows = async (t, p) => (await c.query(t, p)).rows;
  const n = async (t, p) => Number((await rows(t, p))[0].n);

  // export manifest + counts
  const em = join(MIG, "manifests", "export-manifest.json");
  existsSync(em) ? ok("export manifest present") : bad("export manifest missing");
  const man = existsSync(em) ? readJson(em) : { tables: [] };
  const rg = man.tables.find((t) => t.key === "room_guide");
  eq(rg?.antiqueSplitRecords, 8, "export: 8 ROOM GUIDE rows");
  man.tables.filter((t) => t.pii).every((t) => t.contentExported === false)
    ? ok("export: every PII table is count-only (no content written)") : bad("a PII table exported content");

  // normalize determinism
  try {
    execFileSync("node", [join(REPO, "scripts/migration/normalize-antique.mjs"), "--ts=2020-01-01T00:00:00Z"], { cwd: REPO, stdio: "ignore" });
    const a = createHash("sha256").update(readFileSync(join(MIG, "normalized", "antique-split.normalized.json"))).digest("hex");
    execFileSync("node", [join(REPO, "scripts/migration/normalize-antique.mjs"), "--ts=2020-01-01T00:00:00Z"], { cwd: REPO, stdio: "ignore" });
    const b = createHash("sha256").update(readFileSync(join(MIG, "normalized", "antique-split.normalized.json"))).digest("hex");
    a === b ? ok("normalize is deterministic (identical checksum across runs)") : bad("normalize non-deterministic");
  } catch (e) { bad("normalize run failed: " + e.message); }

  // hotel bootstrap + canonical values
  const h = (await rows("select * from hotels where slug='antique-split'"))[0];
  h ? ok("hotel bootstrap: antique-split present") : bad("antique-split hotel missing");
  if (h) {
    (await n("select count(*) n from hotels where slug='antique-split'")) === 1 ? ok("no duplicate antique-split hotel") : bad("duplicate hotel rows");
    h.address_line === "Poljana Grgura Ninskog 1" ? ok("address canonical") : bad("address wrong: " + h.address_line);
    h.reception_phone === "+385 21 785 208" ? ok("reception phone canonical") : bad("phone wrong");
    h.reception_mobile === "+385 91 525 6985" ? ok("reception mobile canonical") : bad("mobile wrong");
    String(h.check_in_time).startsWith("14") && String(h.check_out_time).startsWith("11") ? ok("check-in 14:00 / check-out 11:00") : bad("check-in/out wrong");
    h.legacy_airtable_id ? ok("hotel carries legacy_airtable_id") : bad("hotel missing legacy id");
  }
  const hid = h?.id;

  // rooms + types + inheritance
  eq(await n("select count(*) n from room_types where hotel_id=$1", [hid]), 5, "5 room types");
  eq(await n("select count(*) n from rooms where hotel_id=$1", [hid]), 8, "8 rooms");
  const nums = (await rows("select room_number from rooms where hotel_id=$1 order by room_number", [hid])).map((r) => r.room_number).join(",");
  nums === "101,102,201,202,203,301,302,303" ? ok("room numbers exactly 101..303") : bad("room numbers: " + nums);
  (await n("select count(*) n from rooms where hotel_id=$1 and room_type_id is null", [hid])) === 0 ? ok("every room links to a room type (Pattern C)") : bad("a room has no type");
  const smart = (await rows("select rm.room_number from rooms rm join room_types rt on rt.id=rm.room_type_id where rm.hotel_id=$1 and (rt.smart_glass or rm.smart_glass_override) order by rm.room_number", [hid])).map((r) => r.room_number).join(",");
  smart === "101,201,301" ? ok("Smart Glass exactly on 101/201/301") : bad("smart glass rooms: " + smart);

  // token preservation WITHOUT printing tokens
  const toks = (await rows("select access_token from rooms where hotel_id=$1", [hid])).map((r) => r.access_token);
  toks.length === 8 && toks.every(Boolean) ? ok("all 8 rooms have a non-null access token") : bad("missing room token");
  new Set(toks).size === 8 ? ok("all 8 room tokens unique") : bad("duplicate room tokens");
  const tokFile = join(MIG, "normalized", "tokens.local.json");
  if (existsSync(tokFile)) {
    const src = readJson(tokFile).tokens;
    const dbByRoom = Object.fromEntries((await rows("select room_number, access_token from rooms where hotel_id=$1", [hid])).map((r) => [r.room_number, r.access_token]));
    const allMatch = Object.entries(src).every(([room, t]) => dbByRoom[room] && createHash("sha256").update(t).digest("hex") === createHash("sha256").update(dbByRoom[room]).digest("hex"));
    allMatch ? ok("token preservation: source==DB by hash (values never printed)") : bad("token hash mismatch");
  }

  // services + categories
  eq(await n("select count(*) n from hotel_services where hotel_id=$1", [hid]), 94, "94 services");
  eq(await n("select count(*) n from hotel_services where hotel_id=$1 and status='published'", [hid]), 83, "83 published services");
  (await n("select count(*) n from service_categories where hotel_id=$1", [hid])) >= 20 ? ok("service categories present") : bad("categories missing");
  (await n("select count(*) n from hotel_services where hotel_id=$1 and body_content is null", [hid])) === 0 ? ok("every service has structured body_content") : bad("service missing body");

  // destination content
  const did = (await rows("select id from destinations where slug='split'"))[0]?.id;
  eq(await n("select count(*) n from destination_pois where destination_id=$1 and legacy_airtable_record_id is not null", [did]), 22, "22 POIs");
  eq(await n("select count(*) n from destination_routes where destination_id=$1 and legacy_airtable_record_id is not null", [did]), 6, "6 routes");
  // destination_events holds two source tables (hotel EVENTS + Split Today) — scope by source ids.
  const evIds = readJson(join(MIG, "raw", "events.json")).records.map((r) => r.id);
  const stIds = readJson(join(MIG, "raw", "split_today.json")).records.map((r) => r.id);
  eq((await rows("select count(*)::int n from destination_events where destination_id=$1 and legacy_airtable_record_id = any($2)", [did, evIds]))[0].n, 11, "11 hotel events");
  eq((await rows("select count(*)::int n from destination_events where destination_id=$1 and legacy_airtable_record_id = any($2)", [did, stIds]))[0].n, 49, "49 Split Today events (content completion)");
  (await rows("select count(*)::int n from destination_events where destination_id=$1 and legacy_airtable_record_id = any($2) and status='archived'", [did, stIds]))[0].n > 0 ? ok("expired Split Today events archived") : bad("no Split Today events archived");

  // content completion (rooms/POI/routes/knowledge)
  (await rows("select count(*)::int n from room_types where hotel_id=$1 and minibar_available and kettle_available and blackout_system and underfloor_heating", [hid]))[0].n === 5 ? ok("all 5 room types have structured minibar/kettle/blackout/underfloor") : bad("room structured fields incomplete");
  (await rows("select count(*)::int n from hotel_poi_settings where hotel_id=$1 and walking_time_minutes is not null", [hid]))[0].n === 22 ? ok("22 POIs have walking time") : bad("POI walking time incomplete");
  (await rows("select count(*)::int n from destination_routes where destination_id=$1 and waypoints->>'pois_linked'='true'", [did]))[0].n === 6 ? ok("6 routes have linked POI waypoints") : bad("route waypoints incomplete");
  (await rows("select count(*)::int n from knowledge_articles where hotel_id=$1 and status='published'", [hid]))[0].n >= 7 ? ok("hotel knowledge articles present (>=7)") : bad("knowledge articles missing");
  (await rows("select count(*)::int n from knowledge_aliases where hotel_id=$1", [hid]))[0].n > 0 ? ok("knowledge aliases populated") : bad("no knowledge aliases");
  eq(await n("select count(*) n from hotel_poi_settings where hotel_id=$1", [hid]), 22, "22 hotel POI presentation settings");

  // ai + prices + media
  (await n("select count(*) n from ai_configs where hotel_id=$1", [hid])) === 1 ? ok("ai_configs: exactly one config for hotel") : bad("ai_configs count wrong");
  eq(await n("select count(*) n from price_items where hotel_id=$1", [hid]), 35, "35 price items");
  (await n("select count(*) n from price_items where hotel_id=$1 and (pms_metadata->>'needs_review')='true'", [hid])) === 35 ? ok("all price items flagged needs_review (VAT/validity not inferred)") : bad("price review flags missing");
  const norm = readJson(join(MIG, "normalized", "antique-split.normalized.json"));
  norm.media_manifest.airtable_attachments === 0 ? ok("media manifest: 0 Airtable attachments (none present)") : bad("unexpected attachments");

  // idempotency (dry-run after apply → 0 creates)
  try {
    const out = execFileSync("node", [join(REPO, "scripts/migration/import-antique-to-supabase.mjs")], { cwd: REPO, encoding: "utf8" });
    /\+0~/.test(out) && !/\+[1-9]/.test(out) ? ok("import idempotent: dry-run after apply creates 0 rows") : bad("import not idempotent");
  } catch (e) { bad("import dry-run failed: " + e.message); }

  // compare result
  const cr = join(MIG, "reports", "compare-report.json");
  if (existsSync(cr)) {
    const rep = readJson(cr);
    Object.values(rep.domains).every((d) => d.status === "MATCH") ? ok("compare: all domain counts MATCH") : bad("a domain differs");
    rep.roomMatrix.every((r) => Object.values(r.structured).every((v) => v === "PASS")) ? ok("compare: all 8 rooms structured-PASS") : bad("a room fact differs");
    rep.tokenSafety.result === "TOKEN MATCH" ? ok("compare: TOKEN MATCH") : bad("token mismatch in compare");
    (rep.serviceComparison.filter((s) => s.classification === "MISSING").length === 0) ? ok("compare: no MISSING key services") : bad("a key service is missing");
  } else bad("compare report missing");

  // scope safety: rollback dry-run targets only antique + legacy-marked destination rows
  try {
    const out = execFileSync("node", [join(REPO, "scripts/migration/rollback-antique-dev-import.mjs")], { cwd: REPO, encoding: "utf8" });
    /DRY-RUN — nothing deleted/.test(out) ? ok("rollback defaults to non-destructive dry-run") : bad("rollback not dry-run by default");
  } catch (e) { bad("rollback dry-run failed: " + e.message); }
  // no cross-hotel: antique content never carries another hotel's id
  (await n("select count(*) n from rooms rm join hotels ho on ho.id=rm.hotel_id where ho.slug<>'antique-split' and rm.legacy_airtable_record_id is not null", [])) === 0
    ? ok("no cross-hotel: imported rooms belong only to antique-split") : bad("cross-hotel room leak");

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. No tokens printed; no writes to production.`);
  await c.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("verify error:", e.message); process.exit(1); });
