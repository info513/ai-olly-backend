// Provider-neutral PMS types + safety helpers (server-only). ESM so the Next app
// AND the node test harness import the exact same logic. No Rentlio shapes leak
// out of the adapter — the rest of AI OLLY only ever sees these normalized types.
import { createHash, timingSafeEqual } from "node:crypto";

/** @typedef {'reserved'|'checked_in'|'checked_out'|'cancelled'|'no_show'} PmsReservationStatus */
/** @typedef {{ externalId:string, name:string, timezone?:string|null, currency?:string|null }} PmsProperty */
/** @typedef {{ externalId:string, name:string, unitTypeExternalId?:string|null }} PmsUnit */
/** @typedef {{ externalId:string, name:string }} PmsUnitType */
/** @typedef {{ externalId:string, firstName:(string|null), lastName:(string|null), email?:(string|null), phone?:(string|null), locale?:(string|null), countryCode?:(string|null) }} PmsGuest */
/** @typedef {{ externalId:string, unitExternalId:(string|null), status:(PmsReservationStatus|null), rawStatus:(string|null), arrival:(string|null), departure:(string|null), adults:(number|null), children:number[], guest:(PmsGuest|null), source:('rentlio'|'rentlio_ota'), sourceUpdatedAt:(string|null) }} PmsReservation */
/** @typedef {{ eventId:string, type:string, reservationExternalId:(string|null), unitExternalId?:(string|null), token:(string|null) }} PmsWebhookEvent */
/** @typedef {{ seen:number, created:number, updated:number, skipped:number, failed:number, needsMapping:number, items:object[] }} PmsSyncResult */

export const STAY_STATUSES = ["reserved", "checked_in", "checked_out", "cancelled", "no_show"];

// Documented Rentlio webhook event types (R1).
export const RENTLIO_EVENTS = new Set([
  "reservation-created", "reservation-updated", "reservation-canceled",
  "ota-reservation-received", "ota-reservation-modified", "ota-reservation-canceled",
  "guest-checkedIn-on", "guest-checkedIn-off", "guest-checkedOut-on", "guest-checkedOut-off",
]);

// Rentlio raw status → normalized AI OLLY stay status. Exact Rentlio labels are
// resolved from GET /enums/reservation-statuses at connection; this covers the
// documented lifecycle plus a SAFE fallback: unknown → null (never silently 'reserved').
const RAW_STATUS = {
  new: "reserved", confirmed: "reserved", reserved: "reserved", booked: "reserved", ok: "reserved",
  checked_in: "checked_in", checkedin: "checked_in", in_house: "checked_in", inhouse: "checked_in",
  checked_out: "checked_out", checkedout: "checked_out", departed: "checked_out",
  cancelled: "cancelled", canceled: "cancelled",
  no_show: "no_show", noshow: "no_show",
};
/** @returns {PmsReservationStatus|null} */
export function normalizeStatus(raw) {
  if (raw == null) return null;
  return RAW_STATUS[String(raw).toLowerCase().replace(/[\s-]+/g, "_")] ?? null;
}

// ── PII minimization ──────────────────────────────────────────────────────────
// ONLY these guest fields ever flow into AI OLLY. Everything else is dropped.
export const ALLOWED_GUEST_FIELDS = ["externalId", "firstName", "lastName", "email", "phone", "locale", "countryCode"];
export const DISALLOWED_GUEST_FIELDS = [
  "card", "cardNumber", "cardHolder", "cvv", "iban", "billing", "billingAddress",
  "passport", "idNumber", "documentNumber", "documentType", "taxId", "oib",
  "smartCardId", "notes", "internalNotes", "creditCard", "paymentMethod",
];
/** Keep only allowed guest fields (drops cards/docs/notes/billing). */
export function sanitizeGuest(raw) {
  if (!raw) return null;
  const out = {};
  for (const f of ALLOWED_GUEST_FIELDS) if (raw[f] !== undefined) out[f] = raw[f];
  return out;
}
/** Test aid: returns any disallowed keys still present (should always be empty). */
export function disallowedPresent(obj) {
  const keys = new Set(Object.keys(obj || {}));
  return DISALLOWED_GUEST_FIELDS.filter((d) => keys.has(d));
}
/** PII-minimized webhook payload snapshot for integration_events (no guest contact/cards). */
export function sanitizeEventPayload(payload) {
  const p = payload && payload.event && payload.event.payload ? payload.event.payload : (payload || {});
  return {
    reservationId: p.id ?? p.reservationId ?? null,
    propertyId: p.propertyId ?? null,
    unitId: p.unitId ?? null,
    status: p.status ?? null,
    arrival: p.arrivalDate ?? p.arrival ?? null,
    departure: p.departureDate ?? p.departure ?? null,
    adults: p.adults ?? null,
    guestExternalId: (p.guest && (p.guest.id ?? p.guest.externalId)) ?? null,
    // deliberately NOT: guest name/email/phone, notes, cards, documents.
  };
}

// ── secret helpers ──────────────────────────────────────────────────────────────
export function sha256(s) { return createHash("sha256").update(String(s)).digest("hex"); }
/** Constant-time compare of two shared tokens (compares their sha256 digests). */
export function safeTokenEqual(a, b) {
  const ha = Buffer.from(sha256(a ?? ""), "hex");
  const hb = Buffer.from(sha256(b ?? ""), "hex");
  return ha.length === hb.length && timingSafeEqual(ha, hb);
}
/** Redact anything secret-looking before persisting/logging an error. */
export function redactError(e) {
  let m = e && e.message ? String(e.message) : String(e ?? "error");
  m = m.replace(/apikey[=:]\s*[^\s&"']+/gi, "apikey=***").replace(/token[=:]\s*[^\s&"']+/gi, "token=***");
  return m.slice(0, 300);
}
