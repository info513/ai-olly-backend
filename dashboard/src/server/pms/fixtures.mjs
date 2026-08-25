// Entirely SYNTHETIC Rentlio-shaped fixtures (reserved example.com identities; no real
// Antique/guest data). Shapes mirror the R1-documented Rentlio API/webhook payloads so
// the adapter's normalization is genuinely exercised. Dates use Date.UTC (deterministic).
const ux = (y, m, d, h = 14) => Math.floor(Date.UTC(y, m - 1, d, h) / 1000); // unix seconds (UTC)

export const PROPERTY = { id: "rz-prop-9001", name: "Synthetic Harbour Rooms (TEST)", currency: "EUR" };

export const UNIT_TYPES = [
  { id: "rz-ut-deluxe", name: "Deluxe Room" },
  { id: "rz-ut-superior", name: "Superior Room" },
  { id: "rz-ut-standard", name: "Standard Room" },
  { id: "rz-ut-comfort", name: "Comfort Room" },
  { id: "rz-ut-deluxe-gf", name: "Deluxe Ground Floor" },
];

// 8 physical units resembling an Antique-like hotel + 1 EXTRA unmapped unit (rz-unit-901).
export const UNITS = [
  { id: "rz-unit-101", name: "Room 101 · Deluxe GF", unitTypeId: "rz-ut-deluxe-gf" },
  { id: "rz-unit-102", name: "Room 102 · Comfort GF", unitTypeId: "rz-ut-comfort" },
  { id: "rz-unit-201", name: "Room 201 · Deluxe", unitTypeId: "rz-ut-deluxe" },
  { id: "rz-unit-202", name: "Room 202 · Superior", unitTypeId: "rz-ut-superior" },
  { id: "rz-unit-203", name: "Room 203 · Standard", unitTypeId: "rz-ut-standard" },
  { id: "rz-unit-301", name: "Room 301 · Deluxe", unitTypeId: "rz-ut-deluxe" },
  { id: "rz-unit-302", name: "Room 302 · Superior", unitTypeId: "rz-ut-superior" },
  { id: "rz-unit-303", name: "Room 303 · Standard", unitTypeId: "rz-ut-standard" },
  { id: "rz-unit-901", name: "Room 901 · NEW WING (unmapped)", unitTypeId: "rz-ut-standard" },
];

// Guests. rg-guest-bea deliberately carries DISALLOWED fields to prove PII minimization.
const G = {
  alan: { id: "rg-guest-alan", firstName: "Alan", lastName: "Synthetic", email: "alan@example.com", phone: "+385000000001", locale: "en", countryCode: "GB" },
  bea: { id: "rg-guest-bea", firstName: "Bea", lastName: "Testfield", email: "bea@example.com", phone: "+385000000002", locale: "hr", countryCode: "HR",
    // ↓ must be dropped by sanitizeGuest / never persisted:
    cardNumber: "4111111111111111", cvv: "123", passport: "X1234567", notes: "VIP, allergic to nuts", billing: "Some billing address", oib: "12345678901" },
  cyril: { id: "rg-guest-cyril", firstName: "Cyril", lastName: "Probe", email: "cyril@example.com", phone: null, locale: "de", countryCode: "DE" },
  dina: { id: "rg-guest-dina", firstName: "Dina", lastName: "Mockovic", email: "dina@example.com", phone: "+385000000004", locale: "hr", countryCode: "HR" },
};

// Raw Rentlio-shaped reservation. status in Rentlio raw vocabulary.
const R = (id, unitId, status, arr, dep, guest, extra = {}) => ({
  id, propertyId: PROPERTY.id, unitId, status,
  arrivalDate: arr, departureDate: dep,
  adults: extra.adults ?? 2, childrenAbove12: extra.ch12 ?? 0, childrenBelow12: extra.chU12 ?? 0,
  totalNights: extra.nights ?? 3, notes: extra.notes ?? "internal PMS note — must not reach OLLY",
  source: extra.ota ? "ota" : "direct", updatedAt: extra.updatedAt ?? ux(2026, 8, 20, 9),
  guest,
});

// Baseline reservation set (initial sync).
export const RESERVATIONS = [
  R("rz-res-future", "rz-unit-201", "confirmed", ux(2026, 9, 10), ux(2026, 9, 13), G.alan),        // future reserved
  R("rz-res-inhouse", "rz-unit-202", "checked_in", ux(2026, 9, 1), ux(2026, 9, 4), G.cyril),        // in-house
  R("rz-res-past", "rz-unit-203", "checked_out", ux(2026, 8, 10), ux(2026, 8, 12), G.dina),          // checked out
  R("rz-res-cancel", "rz-unit-301", "cancelled", ux(2026, 9, 20), ux(2026, 9, 22), G.bea),           // cancelled (+PII fields)
  R("rz-res-unmapped", "rz-unit-901", "confirmed", ux(2026, 9, 15), ux(2026, 9, 18), G.dina),        // unit not mapped → NEEDS_MAPPING
  R("rz-res-return", "rz-unit-302", "confirmed", ux(2026, 10, 5), ux(2026, 10, 8), G.alan),          // returning guest (alan again)
];

// Mutations for lifecycle tests, keyed by reservation id (the adapter re-fetches these).
export const MUTATIONS = {
  "rz-res-future": {
    modified: R("rz-res-future", "rz-unit-201", "confirmed", ux(2026, 9, 11), ux(2026, 9, 15), G.alan, { updatedAt: ux(2026, 8, 22, 9) }), // date change
    reassigned: R("rz-res-future", "rz-unit-203", "confirmed", ux(2026, 9, 10), ux(2026, 9, 13), G.alan, { updatedAt: ux(2026, 8, 23, 9) }), // room 201→203
    checkedIn: R("rz-res-future", "rz-unit-201", "checked_in", ux(2026, 9, 10), ux(2026, 9, 13), G.alan, { updatedAt: ux(2026, 8, 24, 9) }),
    checkedOut: R("rz-res-future", "rz-unit-201", "checked_out", ux(2026, 9, 10), ux(2026, 9, 13), G.alan, { updatedAt: ux(2026, 8, 25, 9) }),
    noShow: R("rz-res-future", "rz-unit-201", "no_show", ux(2026, 9, 10), ux(2026, 9, 13), G.alan, { updatedAt: ux(2026, 8, 26, 9) }),
  },
};

// Webhook events (R1 payload shape). event.id is the UUIDv4 idempotency key.
export const wh = (type, eventId, reservationId, token = "SYNTH_WEBHOOK_TOKEN") => ({
  token,
  event: { type, id: eventId, payload: { id: reservationId, propertyId: PROPERTY.id } },
});

export function fixtureUnitToRoomPlan() {
  // Intended mapping the admin would confirm (unit → room number). rz-unit-901 intentionally omitted.
  return {
    "rz-unit-101": "101", "rz-unit-102": "102", "rz-unit-201": "201", "rz-unit-202": "202",
    "rz-unit-203": "203", "rz-unit-301": "301", "rz-unit-302": "302", "rz-unit-303": "303",
  };
}
