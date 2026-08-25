// ============================================================================
// PMS integration SERVICE boundary (Phase R2). The ONLY module the /api/pms/*
// route handlers call — core AI OLLY code never imports Rentlio directly. It wires
// the (synthetic, in R2) Rentlio adapter to the provider-neutral engine and a
// server-only Postgres connection, and returns ONLY safe view data: never a raw
// credential, webhook token, or guest PII. Swapping the transport for the real HTTP
// one + a real key is the single R3 change; nothing else here changes.
// ============================================================================
import pg from "pg";
import { RentlioAdapter, makeSyntheticTransport } from "./rentlio-adapter.mjs";
import { PROPERTY, UNIT_TYPES, UNITS, RESERVATIONS } from "./fixtures.mjs";
import { initialSync, processWebhook } from "./engine.mjs";
import { sha256, redactError } from "./types.mjs";

const SYNTH_TOKEN = "SYNTH_WEBHOOK_TOKEN"; // DEV-only synthetic webhook shared token

function client() {
  const conn = process.env.SUPABASE_DB_URL;
  if (!conn) { const e = new Error("SUPABASE_DB_URL not configured for PMS engine."); e.status = 500; throw e; }
  return new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
}
async function withDb(fn) { const db = client(); await db.connect(); try { return await fn(db); } finally { await db.end(); } }

/** R2: always the synthetic adapter (no network, no real key). R3 swaps the transport. */
function syntheticAdapter() {
  const transport = makeSyntheticTransport({ property: PROPERTY, units: UNITS, unitTypes: UNIT_TYPES, reservations: RESERVATIONS });
  return new RentlioAdapter({ config: { apiKey: "SYNTHETIC", propertyId: PROPERTY.id }, transport });
}

async function loadIntegration(db, hotelId) {
  return (await db.query(`select * from public.hotel_integrations where hotel_id=$1 and provider='rentlio'`, [hotelId])).rows[0] || null;
}

/** Safe, credential-free view for the Settings → Integrations surface. */
export async function getIntegrationView(hotelId) {
  return withDb(async (db) => {
    const integ = await loadIntegration(db, hotelId);
    const rooms = (await db.query(`select id, room_number from public.rooms where hotel_id=$1 and active order by room_number`, [hotelId])).rows;
    if (!integ) return { connected: false, rooms, mappings: [], runs: [], events: [], counts: null };
    const mappings = (await db.query(
      `select m.id, m.external_id, m.external_name, m.room_id, m.active, r.room_number
         from public.external_entity_mappings m left join public.rooms r on r.id=m.room_id
        where m.integration_id=$1 and m.entity_type='room' order by m.external_id`, [integ.id])).rows;
    const runs = (await db.query(
      `select sync_type, status, started_at, completed_at, records_seen, records_created, records_updated, records_skipped, records_failed, needs_mapping, safe_error
         from public.sync_runs where integration_id=$1 order by started_at desc limit 5`, [integ.id])).rows;
    const events = (await db.query(
      `select provider_event_id, event_type, status, received_at, safe_error
         from public.integration_events where integration_id=$1 order by received_at desc limit 10`, [integ.id])).rows;
    const unmapped = mappings.filter((m) => !m.room_id).length;
    return {
      connected: true,
      integration: {
        status: integ.status, externalPropertyId: integ.external_property_id,
        lastSyncedAt: integ.last_synced_at, lastError: integ.last_error,
        hasCredential: !!integ.credential_ref,      // boolean only — never the reference itself
        hasWebhookToken: !!integ.webhook_token_hash, // boolean only — never the token/hash
        synthetic: (integ.credential_ref || "").startsWith("synthetic://"),
      },
      rooms, mappings, runs, events,
      counts: { units: mappings.length, mapped: mappings.length - unmapped, unmapped },
    };
  });
}

/** DEV synthetic connect: seed the integration + provider units so the admin can map. */
export async function connectSynthetic(hotelId, userId) {
  return withDb(async (db) => {
    const integ = (await db.query(
      `insert into public.hotel_integrations (hotel_id, provider, status, external_property_id, credential_ref, webhook_token_hash, created_by, updated_by)
       values ($1,'rentlio','needs_mapping',$2,'synthetic://dev-fixtures',$3,$4,$4)
       on conflict (hotel_id, provider) do update set status='needs_mapping', external_property_id=excluded.external_property_id,
         credential_ref='synthetic://dev-fixtures', webhook_token_hash=excluded.webhook_token_hash, updated_at=now(), updated_by=$4
       returning *`, [hotelId, PROPERTY.id, sha256(SYNTH_TOKEN), userId])).rows[0];
    const adapter = syntheticAdapter();
    const units = await adapter.listUnits();
    for (const u of units) {
      await db.query(
        `insert into public.external_entity_mappings (integration_id, hotel_id, entity_type, external_id, external_name, room_id, active)
         values ($1,$2,'room',$3,$4,null,true)
         on conflict (integration_id, entity_type, external_id) do update set external_name=excluded.external_name, updated_at=now()`,
        [integ.id, hotelId, u.externalId, u.name]);
    }
    return { ok: true };
  });
}

/** Map (or clear, roomId=null) one provider unit → room. Validates the room is this hotel's. */
export async function upsertMapping(hotelId, externalId, roomId) {
  return withDb(async (db) => {
    const integ = await loadIntegration(db, hotelId);
    if (!integ) { const e = new Error("Integration not connected."); e.status = 404; throw e; }
    if (roomId) {
      const r = (await db.query(`select 1 from public.rooms where id=$1 and hotel_id=$2`, [roomId, hotelId])).rows[0];
      if (!r) { const e = new Error("Room not in this hotel."); e.status = 400; throw e; } // cross-hotel room rejected
    }
    await db.query(
      `update public.external_entity_mappings set room_id=$3, updated_at=now()
        where integration_id=$1 and entity_type='room' and external_id=$2`, [integ.id, externalId, roomId || null]);
    // status reflects whether any unit is still unmapped
    const unmapped = (await db.query(`select count(*)::int c from public.external_entity_mappings where integration_id=$1 and entity_type='room' and room_id is null and active`, [integ.id])).rows[0].c;
    await db.query(`update public.hotel_integrations set status=$2, updated_at=now() where id=$1`, [integ.id, unmapped > 0 ? "needs_mapping" : "healthy"]);
    return { ok: true, unmapped };
  });
}

/** Dry-run preview against the synthetic adapter: would-create / update / needs-mapping / skip. */
export async function runSyncPreview(hotelId) {
  return withDb(async (db) => {
    const integ = await loadIntegration(db, hotelId);
    if (!integ) { const e = new Error("Integration not connected."); e.status = 404; throw e; }
    const res = await initialSync(db, integ, syntheticAdapter(), { dryRun: true });
    return { seen: res.seen, wouldCreate: res.created, wouldUpdate: res.updated, needsMapping: res.needsMapping, wouldSkip: res.skipped, failed: res.failed };
  });
}

/** Webhook ingestion: shared-token auth → route to the integration → engine. Server-only. */
export async function ingestWebhook(payload) {
  const token = payload && payload.token;
  if (!token) return { status: 401, body: { error: "missing token" } };
  return withDb(async (db) => {
    const integ = (await db.query(`select * from public.hotel_integrations where webhook_token_hash=$1 and provider='rentlio' limit 1`, [sha256(token)])).rows[0];
    if (!integ) return { status: 401, body: { error: "unrecognized token" } };
    try {
      const r = await processWebhook(db, integ, syntheticAdapter(), payload);
      return { status: r.status || 200, body: { ok: r.ok !== false, duplicate: !!r.duplicate, skipped: !!r.skipped, error: !!r.error } };
    } catch (e) { return { status: 200, body: { ok: false, error: redactError(e) } }; }
  });
}
