// PMS integration engine — provider-neutral. Consumes NORMALIZED reservations from a
// PMSAdapter and maps them onto existing stays/guests. Never touches consent, never
// deletes, never stores disallowed PII. `db` is any pg-style client ({ query(sql,params) }).
// The webhook/sync paths run server-side (service-role); tests inject a superuser client.
import { timingSafeEqual } from "node:crypto";
import { sanitizeGuest, sanitizeEventPayload, sha256, redactError } from "./types.mjs";

const nowIso = () => new Date().toISOString();

// ── mapping helpers ─────────────────────────────────────────────────────────────
/** Rentlio unit → AI OLLY room. Returns room uuid, or null when unit is unmapped
 *  (no mapping row, or mapping with room_id NULL). Never guesses a room. */
async function resolveRoom(db, integrationId, unitExternalId) {
  if (!unitExternalId) return { known: false, roomId: null };
  const r = (await db.query(
    `select room_id from public.external_entity_mappings
      where integration_id=$1 and entity_type='room' and external_id=$2 and active`,
    [integrationId, unitExternalId])).rows[0];
  return { known: !!r, roomId: r ? r.room_id : null };
}

async function findStay(db, hotelId, externalId) {
  return (await db.query(
    `select id, status, room_id, guest_id from public.stays
      where hotel_id=$1 and external_source in ('rentlio','rentlio_ota') and external_id=$2`,
    [hotelId, externalId])).rows[0] || null;
}

/** Upsert a Rentlio guest by external identity. NEVER auto-merges on weak signals —
 *  a possible match becomes a duplicate SUGGESTION, and a fresh guest is created. */
async function upsertGuest(db, hotelId, rawGuest) {
  const g = sanitizeGuest(rawGuest);
  if (!g || !g.externalId) return null;
  const existing = (await db.query(
    `select id from public.guests where hotel_id=$1 and external_source='rentlio' and external_id=$2`,
    [hotelId, g.externalId])).rows[0];
  if (existing) {
    await db.query(
      `update public.guests set
         first_name=coalesce($2, first_name), last_name=coalesce($3, last_name),
         email=coalesce($4, email), phone=coalesce($5, phone),
         preferred_locale=coalesce($6, preferred_locale), country_code=coalesce($7, country_code),
         updated_at=now()
       where id=$1`,
      [existing.id, g.firstName ?? null, g.lastName ?? null, g.email ?? null, g.phone ?? null, g.locale ?? null, g.countryCode ?? null]);
    return existing.id;
  }
  // No external match → create a new guest (reservation identity ≠ guest identity).
  const created = (await db.query(
    `insert into public.guests (hotel_id, first_name, last_name, email, phone, preferred_locale, country_code, external_source, external_id)
     values ($1,$2,$3,$4,$5,$6,$7,'rentlio',$8) returning id`,
    [hotelId, g.firstName ?? null, g.lastName ?? null, g.email ?? null, g.phone ?? null, g.locale ?? null, g.countryCode ?? null, g.externalId])).rows[0];
  // Weak-signal candidate? SUGGEST, do not merge.
  const cand = (await db.query(
    `select id from public.guests where hotel_id=$1 and id<>$2 and (external_source is distinct from 'rentlio')
       and ( (email is not null and lower(email)=lower($3))
             or (first_name is not null and last_name is not null and lower(first_name)=lower(coalesce($4,'')) and lower(last_name)=lower(coalesce($5,''))) )
     limit 1`,
    [hotelId, created.id, g.email ?? null, g.firstName ?? null, g.lastName ?? null])).rows[0];
  if (cand) {
    await db.query(
      `insert into public.guest_duplicate_suggestions (hotel_id, guest_id, candidate_guest_id, match_reason, match_score, status)
       values ($1,$2,$3,$4,$5,'pending') on conflict do nothing`,
      [hotelId, created.id, cand.id, g.email ? "email" : "name", g.email ? 0.7 : 0.4]);
  }
  return created.id;
}

/** Upsert a stay by (hotel, external identity). Idempotent: same reservation → same stay. */
async function upsertStay(db, hotelId, res, roomId, guestId) {
  const cin = res.status === "checked_in" || res.status === "checked_out" ? nowIso() : null;
  const cout = res.status === "checked_out" ? nowIso() : null;
  const source = res.source || "rentlio";
  const row = (await db.query(
    `insert into public.stays (hotel_id, guest_id, room_id, status, arrival_at, departure_at, external_source, external_id, checked_in_at, checked_out_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (hotel_id, external_source, external_id) where external_id is not null
     do update set guest_id=coalesce(excluded.guest_id, public.stays.guest_id),
        room_id=excluded.room_id, status=excluded.status,
        arrival_at=excluded.arrival_at, departure_at=excluded.departure_at,
        checked_in_at=coalesce(public.stays.checked_in_at, excluded.checked_in_at),
        checked_out_at=coalesce(public.stays.checked_out_at, excluded.checked_out_at),
        updated_at=now()
     returning id`,
    [hotelId, guestId, roomId, res.status, res.arrival, res.departure, source, res.externalId, cin, cout])).rows[0];
  return row.id;
}

/** Cancel a stay by external id (state transition — NEVER deletes guest/stay/history). */
async function cancelStay(db, hotelId, externalId) {
  await db.query(
    `update public.stays set status='cancelled', updated_at=now()
      where hotel_id=$1 and external_source in ('rentlio','rentlio_ota') and external_id=$2`,
    [hotelId, externalId]);
}

/** Apply ONE normalized reservation. dryRun → compute the action without writing guest/stay. */
export async function applyReservation(db, integ, res, { dryRun = false } = {}) {
  if (!res || !res.externalId) return { action: "failed", reason: "no_external_id" };
  if (!res.status) return { action: dryRun ? "would_skip" : "skipped", reason: "unmapped_status", externalId: res.externalId };
  const { roomId } = res.unitExternalId ? await resolveRoom(db, integ.id, res.unitExternalId) : { roomId: null };
  if (res.unitExternalId && roomId === null) return { action: "needs_mapping", externalId: res.externalId, unit: res.unitExternalId };
  const existing = await findStay(db, integ.hotel_id, res.externalId);
  if (dryRun) return { action: existing ? "would_update" : "would_create", externalId: res.externalId, roomId };
  const guestId = res.guest ? await upsertGuest(db, integ.hotel_id, res.guest) : (existing ? existing.guest_id : null);
  const stayId = await upsertStay(db, integ.hotel_id, res, roomId, guestId);
  return { action: existing ? "updated" : "created", externalId: res.externalId, stayId, roomId, guestId };
}

// ── initial sync ────────────────────────────────────────────────────────────────
export async function initialSync(db, integ, adapter, { dryRun = false } = {}) {
  const run = dryRun ? null : (await db.query(
    `insert into public.sync_runs (integration_id, hotel_id, sync_type, status) values ($1,$2,'initial','running') returning id`,
    [integ.id, integ.hotel_id])).rows[0].id;
  /** @type {import('./types.mjs').PmsSyncResult} */
  const res = { seen: 0, created: 0, updated: 0, skipped: 0, failed: 0, needsMapping: 0, items: [] };
  try {
    const reservations = await adapter.listReservations();
    for (const r of reservations) {
      res.seen++;
      try {
        const out = await applyReservation(db, integ, r, { dryRun });
        if (out.action === "created" || out.action === "would_create") res.created++;
        else if (out.action === "updated" || out.action === "would_update") res.updated++;
        else if (out.action === "needs_mapping") res.needsMapping++;
        else if (out.action === "skipped" || out.action === "would_skip") res.skipped++;
        else res.failed++;
        res.items.push(out);
      } catch (e) { res.failed++; res.items.push({ action: "failed", externalId: r.externalId, error: redactError(e) }); }
    }
    if (!dryRun) await db.query(
      `update public.sync_runs set status='completed', completed_at=now(),
         records_seen=$2, records_created=$3, records_updated=$4, records_skipped=$5, records_failed=$6, needs_mapping=$7
       where id=$1`,
      [run, res.seen, res.created, res.updated, res.skipped, res.failed, res.needsMapping]);
    if (!dryRun) await db.query(`update public.hotel_integrations set last_synced_at=now(), status=$2, updated_at=now() where id=$1`,
      [integ.id, res.needsMapping > 0 ? "needs_mapping" : "healthy"]);
  } catch (e) {
    if (!dryRun) await db.query(`update public.sync_runs set status='failed', completed_at=now(), safe_error=$2 where id=$1`, [run, redactError(e)]);
    throw e;
  }
  return res;
}

// ── reconciliation ────────────────────────────────────────────────────────────────
export async function reconcile(db, integ, adapter) {
  const run = (await db.query(
    `insert into public.sync_runs (integration_id, hotel_id, sync_type, status) values ($1,$2,'reconcile','running') returning id`,
    [integ.id, integ.hotel_id])).rows[0].id;
  const summary = { seen: 0, created: 0, updated: 0, cancelledMissing: 0, needsMapping: 0, failed: 0, items: [] };
  try {
    const reservations = await adapter.listReservations();
    const seenIds = new Set();
    for (const r of reservations) {
      summary.seen++; seenIds.add(r.externalId);
      const out = await applyReservation(db, integ, r, { dryRun: false });
      if (out.action === "created") summary.created++;
      else if (out.action === "updated") summary.updated++;
      else if (out.action === "needs_mapping") summary.needsMapping++;
      summary.items.push(out);
    }
    // Reservations that disappeared from the provider → cancel the stay (never delete).
    const localOpen = (await db.query(
      `select external_id from public.stays where hotel_id=$1 and external_source in ('rentlio','rentlio_ota')
         and external_id is not null and status in ('reserved','checked_in')`, [integ.hotel_id])).rows;
    for (const s of localOpen) {
      if (!seenIds.has(s.external_id)) { await cancelStay(db, integ.hotel_id, s.external_id); summary.cancelledMissing++; }
    }
    await db.query(`update public.sync_runs set status='completed', completed_at=now(),
       records_seen=$2, records_created=$3, records_updated=$4, records_skipped=$5, needs_mapping=$6 where id=$1`,
      [run, summary.seen, summary.created, summary.updated, summary.cancelledMissing, summary.needsMapping]);
  } catch (e) {
    await db.query(`update public.sync_runs set status='failed', completed_at=now(), safe_error=$2 where id=$1`, [run, redactError(e)]);
    throw e;
  }
  return summary;
}

// ── webhook ────────────────────────────────────────────────────────────────────
async function recordEvent(db, integ, ev, rawPayload) {
  // Returns true if first-seen (inserted), false if duplicate (idempotent no-op).
  const r = await db.query(
    `insert into public.integration_events (integration_id, hotel_id, provider, provider_event_id, event_type, external_entity_id, status, attempt_count, payload_digest, payload)
     values ($1,$2,'rentlio',$3,$4,$5,'received',1,$6,$7)
     on conflict (integration_id, provider_event_id) do nothing returning id`,
    [integ.id, integ.hotel_id, ev.eventId, ev.type, ev.reservationExternalId ?? null,
     sha256(JSON.stringify(rawPayload ?? {})), JSON.stringify(sanitizeEventPayload(rawPayload))]);
  return r.rows.length > 0;
}
async function markEvent(db, integ, eventId, status, safeErr) {
  await db.query(
    `update public.integration_events set status=$3, processed_at=now(), safe_error=$4
      where integration_id=$1 and provider_event_id=$2`,
    [integ.id, eventId, status, safeErr ?? null]);
}

/** Full webhook ingestion: token check → parse → idempotency → authoritative re-fetch → apply.
 *  Never trusts webhook guest data as the source of truth (re-fetches from the API). */
export async function processWebhook(db, integ, adapter, payload) {
  if (!webhookTokenMatches(payload && payload.token, integ.webhook_token_hash)) {
    return { ok: false, status: 401, reason: "bad_token" };
  }
  const parsed = adapter.parseWebhook(payload);
  if (!parsed.ok) {
    if (parsed.error === "unsupported_event_type") {
      await recordEvent(db, integ, { eventId: parsed.eventId, type: parsed.type, reservationExternalId: null }, payload);
      await markEvent(db, integ, parsed.eventId, "skipped", "unsupported_event_type");
      return { ok: true, status: 200, skipped: true, reason: "unsupported_event_type" };
    }
    return { ok: false, status: 400, reason: parsed.error };
  }
  const ev = parsed.event;
  const first = await recordEvent(db, integ, ev, payload);
  if (!first) return { ok: true, status: 200, duplicate: true }; // idempotent

  const isCancel = /cancel/i.test(ev.type);
  try {
    if (!ev.reservationExternalId) { await markEvent(db, integ, ev.eventId, "processed"); return { ok: true, status: 200 }; }
    let res;
    try { res = await adapter.getReservation(ev.reservationExternalId); }
    catch (e) {
      if (isCancel) { await cancelStay(db, integ.hotel_id, ev.reservationExternalId); await markEvent(db, integ, ev.eventId, "processed"); return { ok: true, status: 200, cancelled: true }; }
      throw e;
    }
    // Event-driven status override (check-in/out events drive lifecycle even if the
    // reservation object itself doesn't reflect it), then apply authoritative re-fetch.
    if (ev.type === "guest-checkedIn-on") res.status = "checked_in";
    else if (ev.type === "guest-checkedIn-off") res.status = "reserved";
    else if (ev.type === "guest-checkedOut-on") res.status = "checked_out";
    else if (ev.type === "guest-checkedOut-off") res.status = "checked_in";
    else if (isCancel) res.status = "cancelled";
    const out = await applyReservation(db, integ, res, { dryRun: false });
    await markEvent(db, integ, ev.eventId, out.action === "needs_mapping" ? "skipped" : "processed");
    return { ok: true, status: 200, result: out };
  } catch (e) {
    await markEvent(db, integ, ev.eventId, "error", redactError(e));
    return { ok: true, status: 200, error: true }; // 200 to avoid Rentlio retry-storm/suspension; reconciliation repairs it
  }
}

/** Constant-time compare of an incoming token against the stored sha256 hash. */
export function webhookTokenMatches(rawToken, storedHash) {
  if (!storedHash) return false;
  const got = Buffer.from(sha256(rawToken ?? ""), "hex");
  const exp = Buffer.from(String(storedHash), "hex");
  try { return got.length === exp.length && timingSafeEqual(got, exp); }
  catch { return false; }
}
