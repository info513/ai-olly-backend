// Rentlio adapter — implements the PMSAdapter contract against the R1-documented
// official API (api.rentl.io/v1, apikey auth, pagination). The transport is INJECTED:
// tests use a synthetic in-memory store (no network); production would use the HTTP
// transport below. Nothing here leaks Rentlio JSON — callers get normalized types.
import { normalizeStatus, sanitizeGuest, RENTLIO_EVENTS } from "./types.mjs";

const API_BASE = "https://api.rentl.io/v1";
const isoFromUnix = (u) => (u == null ? null : new Date(Number(u) * 1000).toISOString());

/** Real HTTP transport (documented; NOT used in R2 tests — tests inject the synthetic one).
 *  Respects apikey header + pagination; callers must honor rate limits (15/s, 10k/hr). */
export function makeHttpTransport({ apiKey, baseUrl = API_BASE, fetchImpl = fetch }) {
  const get = async (path, params = {}) => {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
    const res = await fetchImpl(url.toString(), { headers: { apikey: apiKey, accept: "application/json" } });
    if (res.status === 429) throw new Error("rentlio rate limit (429)");
    if (!res.ok) throw new Error(`rentlio HTTP ${res.status}`);
    return res.json();
  };
  return { get };
}

/** Synthetic transport for tests: a mutable reservation store (re-fetch is authoritative). */
export function makeSyntheticTransport({ property, units, unitTypes, reservations }) {
  const store = new Map(reservations.map((r) => [r.id, structuredClone(r)]));
  const t = {
    async get(path) {
      if (path === "/properties") return { data: [property] };
      if (/\/units$/.test(path)) return { data: units };
      if (/\/unit-types$/.test(path)) return { data: unitTypes };
      if (path === "/reservations") return { data: [...store.values()] };
      const m = path.match(/^\/reservations\/(.+)\/details$/);
      if (m) { const r = store.get(m[1]); if (!r) throw new Error(`reservation ${m[1]} not found`); return { data: r }; }
      throw new Error(`synthetic transport: unmapped path ${path}`);
    },
  };
  // Test controls: simulate provider-side mutations / disappearance.
  t.__setReservation = (r) => store.set(r.id, structuredClone(r));
  t.__removeReservation = (id) => store.delete(id);
  t.__has = (id) => store.has(id);
  return t;
}

export class RentlioAdapter {
  /** @param {{ config:{apiKey?:string, propertyId?:string}, transport:{get:Function} }} o */
  constructor({ config, transport }) {
    this.provider = "rentlio";
    this.config = config || {};
    this.transport = transport;
  }

  async verifyConnection() {
    if (!this.config.apiKey) return { ok: false, error: "missing_api_key" };
    try {
      const props = (await this.transport.get("/properties")).data || [];
      const prop = this.config.propertyId ? props.find((p) => p.id === this.config.propertyId) : props[0];
      if (!prop) return { ok: false, error: "property_not_found" };
      return { ok: true, propertyName: prop.name };
    } catch (e) { return { ok: false, error: "connection_failed" }; }
  }

  /** @returns {Promise<import('./types.mjs').PmsProperty>} */
  async getProperty() {
    const props = (await this.transport.get("/properties")).data || [];
    const p = this.config.propertyId ? props.find((x) => x.id === this.config.propertyId) : props[0];
    if (!p) throw new Error("property_not_found");
    return { externalId: p.id, name: p.name, currency: p.currency ?? null, timezone: p.timezone ?? null };
  }

  /** @returns {Promise<import('./types.mjs').PmsUnit[]>} */
  async listUnits() {
    const raw = (await this.transport.get(`/properties/${this.config.propertyId}/units`)).data || [];
    return raw.map((u) => ({ externalId: u.id, name: u.name, unitTypeExternalId: u.unitTypeId ?? null }));
  }

  /** @returns {Promise<import('./types.mjs').PmsUnitType[]>} */
  async listUnitTypes() {
    const raw = (await this.transport.get(`/properties/${this.config.propertyId}/unit-types`)).data || [];
    return raw.map((u) => ({ externalId: u.id, name: u.name }));
  }

  /** @returns {Promise<import('./types.mjs').PmsReservation[]>} */
  async listReservations() {
    const raw = (await this.transport.get("/reservations")).data || [];
    return raw.map((r) => this.normalizeReservation(r));
  }

  /** @returns {Promise<import('./types.mjs').PmsReservation>} */
  async getReservation(externalId) {
    const raw = (await this.transport.get(`/reservations/${externalId}/details`)).data;
    return this.normalizeReservation(raw);
  }

  /** Pure: raw Rentlio reservation → normalized. Drops all non-allowed guest fields. */
  normalizeReservation(raw) {
    const g = raw.guest
      ? sanitizeGuest({
          externalId: raw.guest.id ?? raw.guest.externalId,
          firstName: raw.guest.firstName ?? null, lastName: raw.guest.lastName ?? null,
          email: raw.guest.email ?? null, phone: raw.guest.phone ?? null,
          locale: raw.guest.locale ?? null, countryCode: raw.guest.countryCode ?? raw.guest.country ?? null,
        })
      : null;
    return {
      externalId: raw.id,
      unitExternalId: raw.unitId ?? null,
      rawStatus: raw.status ?? null,
      status: normalizeStatus(raw.status),
      arrival: isoFromUnix(raw.arrivalDate),
      departure: isoFromUnix(raw.departureDate),
      adults: raw.adults ?? null,
      children: (raw.childrenAbove12 ?? 0) + (raw.childrenBelow12 ?? 0),
      guest: g,
      source: raw.source === "ota" ? "rentlio_ota" : "rentlio",
      sourceUpdatedAt: isoFromUnix(raw.updatedAt),
    };
  }

  /** Parse + validate a webhook envelope into a normalized event (token checked by caller). */
  parseWebhook(payload) {
    const ev = payload && payload.event;
    if (!ev || !ev.id || !ev.type) return { ok: false, error: "malformed_event" };
    if (!RENTLIO_EVENTS.has(ev.type)) return { ok: false, error: "unsupported_event_type", eventId: ev.id, type: ev.type };
    return {
      ok: true,
      event: {
        eventId: ev.id, type: ev.type, token: payload.token ?? null,
        reservationExternalId: (ev.payload && ev.payload.id) ?? null,
        unitExternalId: (ev.payload && ev.payload.unitId) ?? null,
      },
    };
  }
}

export { API_BASE };
