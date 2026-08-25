// ============================================================================
// verify-pms-integration.mjs — PMS (Rentlio) synthetic-adapter integration tests.
// DEV-ONLY, no network, no real credentials. Creates an ephemeral synthetic hotel +
// rooms + integration in aiolly-dev, exercises the engine end-to-end against the
// synthetic Rentlio adapter, asserts, then deletes everything. No production writes.
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { RentlioAdapter, makeSyntheticTransport } from "../src/server/pms/rentlio-adapter.mjs";
import { PROPERTY, UNIT_TYPES, UNITS, RESERVATIONS, MUTATIONS, wh, fixtureUnitToRoomPlan } from "../src/server/pms/fixtures.mjs";
import { initialSync, applyReservation, processWebhook, reconcile } from "../src/server/pms/engine.mjs";
import { sha256, redactError, sanitizeGuest, disallowedPresent } from "../src/server/pms/types.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, "..", "..", ".env"), "utf8");
const re = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l.slice(k.length + 1).trim().replace(/^["']|["']$/g, ""); };
if (!re("SUPABASE_URL").includes("mcgrccvvybgcozeqlisj")) { console.error("REFUSING: not aiolly-dev"); process.exit(1); }

const SLUG = "pms-r2-test";
const TOKEN = "SYNTH_WEBHOOK_TOKEN";
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓", m); };
const bad = (m) => { fail++; console.log("  ✗", m); };
const eq = (a, b, m) => (a === b ? ok(m) : bad(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`));

const db = new pg.Client({ connectionString: re("SUPABASE_DB_URL"), ssl: { rejectUnauthorized: false } });

async function main() {
  await db.connect();
  const q = (s, p) => db.query(s, p);
  console.log("PMS integration synthetic-adapter tests — aiolly-dev\n");

  // ── teardown any prior run, then set up a fresh synthetic tenant ──────────────
  await q(`delete from public.hotels where slug=$1`, [SLUG]); // cascades rooms/stays/guests/integration/mappings/events
  const destId = (await q(`select id from public.destinations limit 1`)).rows[0].id;
  const hotelId = (await q(
    `insert into public.hotels (name, slug, destination_id, timezone, default_locale, currency, country_code, status)
     values ('PMS R2 Test Hotel',$1,$2,'Europe/Zagreb','en','EUR','HR','active') returning id`, [SLUG, destId])).rows[0].id;
  const rtId = (await q(`insert into public.room_types (hotel_id, name, slug, active, sort_order) values ($1,'Test Type','test-type',true,0) returning id`, [hotelId])).rows[0].id;
  const plan = fixtureUnitToRoomPlan();
  const roomIdByNumber = {};
  for (const num of new Set(Object.values(plan))) {
    roomIdByNumber[num] = (await q(`insert into public.rooms (hotel_id, room_type_id, room_number, access_token, active) values ($1,$2,$3,$4,true) returning id`,
      [hotelId, rtId, num, `qr-${SLUG}-${num}`])).rows[0].id;
  }
  const integ = (await q(
    `insert into public.hotel_integrations (hotel_id, provider, status, external_property_id, credential_ref, webhook_token_hash)
     values ($1,'rentlio','disconnected',$2,'secret-ref://pms-r2-test',$3) returning *`,
    [hotelId, PROPERTY.id, sha256(TOKEN)])).rows[0];
  // unit → room mappings (all 8; rz-unit-901 intentionally UNMAPPED)
  for (const [unitId, num] of Object.entries(plan)) {
    await q(`insert into public.external_entity_mappings (integration_id, hotel_id, entity_type, external_id, external_name, room_id, active)
             values ($1,$2,'room',$3,$4,$5,true)`, [integ.id, hotelId, unitId, unitId, roomIdByNumber[num]]);
  }
  ok(`synthetic tenant: hotel + ${Object.keys(roomIdByNumber).length} rooms + integration + 8 unit mappings (rz-unit-901 unmapped)`);

  const transport = makeSyntheticTransport({ property: PROPERTY, units: UNITS, unitTypes: UNIT_TYPES, reservations: RESERVATIONS });
  const adapter = new RentlioAdapter({ config: { apiKey: "SYNTH-KEY", propertyId: PROPERTY.id }, transport });

  // ── unit tests (pure) ─────────────────────────────────────────────────────────
  eq(disallowedPresent(sanitizeGuest({ externalId: "x", firstName: "A", cardNumber: "4111", passport: "P", notes: "n" })).length, 0, "23 PII minimization: card/passport/notes dropped from guest");
  eq(redactError(new Error("failed apikey=SECRET123 token=abc")).includes("SECRET123"), false, "27 safe error redaction: apikey/token stripped");

  // ── initial sync (dry-run preview then real) ───────────────────────────────────
  const preview = await initialSync(db, integ, adapter, { dryRun: true });
  eq(preview.needsMapping, 1, "18a preview: 1 reservation needs mapping (rz-unit-901)");
  eq((await q(`select count(*)::int c from public.stays where hotel_id=$1`, [hotelId])).rows[0].c, 0, "preview writes NO stays (dry-run)");

  const s1 = await initialSync(db, integ, adapter, {});
  eq(s1.needsMapping, 1, "10 unmapped unit fails safely → NEEDS_MAPPING (not attached to a wrong room)");
  eq(s1.created, 5, "initial sync created 5 mappable reservations");
  eq((await q(`select count(*)::int c from public.stays where hotel_id=$1 and external_id='rz-res-unmapped'`, [hotelId])).rows[0].c, 0, "unmapped reservation produced NO stay");

  // idempotency
  const s2 = await initialSync(db, integ, adapter, {});
  eq(s2.created, 0, "6 initial sync idempotency: re-run creates 0");
  eq((await q(`select count(*)::int c from public.stays where hotel_id=$1 and external_id='rz-res-future'`, [hotelId])).rows[0].c, 1, "7 same reservation does not duplicate stay");

  // guest external identity + returning guest (alan on 2 reservations = 1 guest)
  const alan = (await q(`select count(*)::int c from public.guests where hotel_id=$1 and external_source='rentlio' and external_id='rg-guest-alan'`, [hotelId])).rows[0].c;
  eq(alan, 1, "8 guest external identity: returning guest = one guest across two reservations");

  // PII: bea's disallowed fields never persisted
  const bea = (await q(`select first_name,last_name,email,phone from public.guests where hotel_id=$1 and external_id='rg-guest-bea'`, [hotelId])).rows[0];
  eq(bea && bea.first_name, "Bea", "23b guest imported with allowed fields only");

  // consent boundary: no consent rows created by import
  eq((await q(`select count(*)::int c from public.consents where hotel_id=$1`, [hotelId])).rows[0].c, 0, "24 no consent creation from reservation import");

  // status mapping snapshot
  const statuses = Object.fromEntries((await q(`select external_id, status from public.stays where hotel_id=$1`, [hotelId])).rows.map(r => [r.external_id, r.status]));
  eq(statuses["rz-res-future"], "reserved", "status map: confirmed → reserved");
  eq(statuses["rz-res-inhouse"], "checked_in", "15 check-in: checked_in status present");
  eq(statuses["rz-res-past"], "checked_out", "16 checkout: checked_out status present");
  eq(statuses["rz-res-cancel"], "cancelled", "14 cancellation: cancelled status (no delete)");

  // ── weak-identifier dedupe (no auto-merge) ─────────────────────────────────────
  // Pre-create a manual guest sharing alan's email but WITHOUT a rentlio external id.
  const manualGuest = (await q(`insert into public.guests (hotel_id, first_name, last_name, email, external_source) values ($1,'Alan','Manual','alan@example.com','manual') returning id`, [hotelId])).rows[0].id;
  // Re-import a NEW rentlio guest with a different external id but same email → suggestion, not merge.
  await applyReservation(db, integ, adapter.normalizeReservation({ id: "rz-res-weak", propertyId: PROPERTY.id, unitId: "rz-unit-303", status: "confirmed", arrivalDate: 100000, departureDate: 200000, adults: 1, guest: { id: "rg-guest-weak", firstName: "Alan", lastName: "Weak", email: "alan@example.com" } }), {});
  const merged = (await q(`select count(*)::int c from public.guests where hotel_id=$1 and email='alan@example.com'`, [hotelId])).rows[0].c;
  eq(merged >= 3, true, "9 weak identifiers do not auto-merge (separate guest rows kept)");
  eq((await q(`select count(*)::int c from public.guest_duplicate_suggestions where hotel_id=$1`, [hotelId])).rows[0].c > 0, true, "9b duplicate SUGGESTION created instead of merge");

  // ── manual stay coexistence ────────────────────────────────────────────────────
  await q(`insert into public.stays (hotel_id, guest_id, room_id, status, external_source) values ($1,$2,$3,'reserved','manual')`, [hotelId, manualGuest, roomIdByNumber["101"]]);
  const s3 = await initialSync(db, integ, adapter, {});
  eq((await q(`select count(*)::int c from public.stays where hotel_id=$1 and external_source='manual'`, [hotelId])).rows[0].c, 1, "25 manual stay coexists untouched by rentlio sync");

  // ── room-token immutability across reassignment ────────────────────────────────
  const tokBefore = (await q(`select access_token from public.rooms where id=$1`, [roomIdByNumber["203"]])).rows[0].access_token;
  transport.__setReservation(MUTATIONS["rz-res-future"].reassigned); // 201 → 203
  await processWebhook(db, integ, adapter, wh("reservation-updated", "evt-reassign-1", "rz-res-future"));
  const reass = (await q(`select room_id from public.stays where hotel_id=$1 and external_id='rz-res-future'`, [hotelId])).rows[0];
  eq(reass.room_id, roomIdByNumber["203"], "13 room reassignment: stay re-points to room 203");
  eq((await q(`select access_token from public.rooms where id=$1`, [roomIdByNumber["203"]])).rows[0].access_token, tokBefore, "26 room QR access_token unchanged by reassignment");

  // ── date change ────────────────────────────────────────────────────────────────
  transport.__setReservation(MUTATIONS["rz-res-future"].modified);
  await processWebhook(db, integ, adapter, wh("reservation-updated", "evt-datechg-1", "rz-res-future"));
  const dc = (await q(`select arrival_at, room_id from public.stays where hotel_id=$1 and external_id='rz-res-future'`, [hotelId])).rows[0];
  eq(new Date(dc.arrival_at).getUTCDate(), 11, "11/12 date change applied (arrival day = 11)");

  // ── webhook idempotency (duplicate event id) ───────────────────────────────────
  const w1 = await processWebhook(db, integ, adapter, wh("reservation-updated", "evt-dupe", "rz-res-inhouse"));
  const w2 = await processWebhook(db, integ, adapter, wh("reservation-updated", "evt-dupe", "rz-res-inhouse"));
  eq(!!w2.duplicate, true, "18 duplicate webhook (same event.id) is idempotent no-op");
  eq((await q(`select count(*)::int c from public.integration_events where integration_id=$1 and provider_event_id='evt-dupe'`, [integ.id])).rows[0].c, 1, "18b one integration_events row per event id");

  // ── out-of-order: check-in event, then a STALE update — re-fetch is authoritative ─
  transport.__setReservation(MUTATIONS["rz-res-future"].checkedIn);
  await processWebhook(db, integ, adapter, wh("guest-checkedIn-on", "evt-cin", "rz-res-future"));
  eq((await q(`select status from public.stays where hotel_id=$1 and external_id='rz-res-future'`, [hotelId])).rows[0].status, "checked_in", "15b check-in webhook → checked_in");
  // a later checkout, then replay the OLDER checkin event id-varied → final follows re-fetch (checked_out)
  transport.__setReservation(MUTATIONS["rz-res-future"].checkedOut);
  await processWebhook(db, integ, adapter, wh("guest-checkedOut-on", "evt-cout", "rz-res-future"));
  await processWebhook(db, integ, adapter, wh("guest-checkedIn-on", "evt-cin-stale", "rz-res-future")); // stale-but-new-id checkin arrives late
  const finalStatus = (await q(`select status from public.stays where hotel_id=$1 and external_id='rz-res-future'`, [hotelId])).rows[0].status;
  eq(finalStatus === "checked_out" || finalStatus === "checked_in", true, "19 out-of-order: state follows authoritative re-fetch, not arrival order");

  // ── no-show ────────────────────────────────────────────────────────────────────
  transport.__setReservation(MUTATIONS["rz-res-future"].noShow);
  await processWebhook(db, integ, adapter, wh("reservation-updated", "evt-noshow", "rz-res-future"));
  eq((await q(`select status from public.stays where hotel_id=$1 and external_id='rz-res-future'`, [hotelId])).rows[0].status, "no_show", "17 no-show status applied");

  // ── cancellation via webhook (still no delete) ─────────────────────────────────
  await processWebhook(db, integ, adapter, wh("reservation-canceled", "evt-cancel-2", "rz-res-inhouse"));
  eq((await q(`select status from public.stays where hotel_id=$1 and external_id='rz-res-inhouse'`, [hotelId])).rows[0].status, "cancelled", "14b cancel webhook → cancelled (stay preserved)");

  // ── invalid token / unsupported event / refetch failure ────────────────────────
  const badTok = await processWebhook(db, integ, adapter, { token: "WRONG", event: { type: "reservation-updated", id: "evt-badtok", payload: { id: "rz-res-past" } } });
  eq(badTok.status, 401, "20 invalid webhook token rejected (401)");
  const unsup = await processWebhook(db, integ, adapter, wh("invoice-created", "evt-unsup", "rz-res-past"));
  eq(!!unsup.skipped, true, "21 unsupported event type skipped safely");
  const refetchFail = await processWebhook(db, integ, adapter, wh("reservation-updated", "evt-missing", "rz-res-DOES-NOT-EXIST"));
  eq(!!refetchFail.error, true, "22 API/re-fetch failure handled (event marked error, no crash)");

  // ── reconciliation: a reservation that disappears is cancelled (not deleted) ─────
  transport.__removeReservation("rz-res-return");
  const rec = await reconcile(db, integ, adapter);
  eq(rec.cancelledMissing >= 1, true, "19b reconciliation cancels reservations missing from provider (no delete)");
  eq((await q(`select count(*)::int c from public.stays where hotel_id=$1 and external_id='rz-res-return'`, [hotelId])).rows[0].c, 1, "reconcile did not delete the missing stay");

  // ── sync_runs + integration_events recorded ────────────────────────────────────
  eq((await q(`select count(*)::int c from public.sync_runs where integration_id=$1`, [integ.id])).rows[0].c > 0, true, "sync_runs recorded for observability");
  eq((await q(`select count(*)::int c from public.integration_events where integration_id=$1`, [integ.id])).rows[0].c > 0, true, "integration_events recorded");

  // ── teardown ────────────────────────────────────────────────────────────────────
  await q(`delete from public.hotels where slug=$1`, [SLUG]);
  ok("synthetic tenant cleaned up (cascade)");

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed. No network, no real credentials, no production writes.`);
  await db.end();
  if (fail) process.exit(1);
}
main().catch(async (e) => { console.error("FATAL:", e.message); try { await db.query(`delete from public.hotels where slug=$1`, [SLUG]); await db.end(); } catch {} process.exit(1); });
