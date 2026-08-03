// ============================================================================
// rollback-antique-dev-import.mjs — reset the Antique Split DEV import (DEV-ONLY).
// ----------------------------------------------------------------------------
//   node scripts/migration/rollback-antique-dev-import.mjs [--apply]
//
// Deletes ONLY the imported Antique content, scoped to the antique-split hotel and
// the split destination (destination rows additionally require a legacy Airtable id,
// so co-resident seed content is never touched). Keeps the tenant shell (hotels /
// destinations rows) and ALL guest/stay/consent/membership data. Reverse-FK order.
// Refuses any Supabase ref except aiolly-dev. Never cross-hotel.
// ============================================================================

import pg from "pg";
import { assertDevSupabase, readEnv, HOTEL_SLUG } from "./_lib.mjs";

const APPLY = process.argv.includes("--apply");

async function main() {
  const ref = assertDevSupabase();
  console.log(`Antique Split DEV import reset (${ref}) — ${APPLY ? "APPLY" : "DRY-RUN"}\n`);
  const client = new pg.Client({ connectionString: readEnv("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });
  await client.connect();
  const q = (t, p) => client.query(t, p);

  try {
    await q("begin");
    const hotel = (await q("select id from hotels where slug=$1", [HOTEL_SLUG])).rows[0];
    if (!hotel) { console.log("  No antique-split hotel — nothing to reset."); await q("rollback"); return; }
    const hid = hotel.id;
    const dest = (await q("select id from destinations where slug='split'")).rows[0];
    const did = dest?.id ?? null;

    // hotel-scoped content (children first)
    const hotelScoped = [
      "hotel_poi_settings", "hotel_route_settings", "hotel_event_settings",
      "price_items", "price_categories", "ai_configs", "hotel_services", "service_categories",
      "rooms", "room_types",
    ];
    // destination content imported by us (legacy id marks migrated rows only)
    const destScoped = ["destination_pois", "destination_routes", "destination_events"];

    const counts = {};
    for (const t of hotelScoped) {
      const r = await q(`delete from ${t} where hotel_id=$1 returning id`, [hid]);
      counts[t] = r.rowCount;
    }
    if (did) for (const t of destScoped) {
      const r = await q(`delete from ${t} where destination_id=$1 and legacy_airtable_record_id is not null returning id`, [did]);
      counts[t] = r.rowCount;
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log("  " + Object.entries(counts).map(([k, v]) => `${k}: -${v}`).join("\n  "));
    console.log(`\n  ${total} imported rows${APPLY ? " DELETED" : " would be deleted"}. Tenant shell + guest/stay data preserved.`);

    if (APPLY) { await q("commit"); console.log("  COMMITTED. Re-run import to recreate (tokens re-applied exactly from raw)."); }
    else { await q("rollback"); console.log("  DRY-RUN — nothing deleted. Re-run with --apply."); }
  } catch (e) {
    await q("rollback").catch(() => {});
    console.error("  rollback error (rolled back):", e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error("fatal:", e.message); process.exit(1); });
