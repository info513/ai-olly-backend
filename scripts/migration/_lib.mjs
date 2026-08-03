// ============================================================================
// Antique Split migration — shared library (DEV-ONLY, Airtable READ-ONLY).
// ----------------------------------------------------------------------------
// Central guards used by every migration script:
//   • assertDevSupabase()  — refuse any Supabase ref that is not the approved DEV ref.
//   • airtableGet()        — the ONLY Airtable call; GET-only, throws on any other verb.
//   • env loading, checksums, redaction, deterministic JSON, table registry.
// No production Supabase. No Airtable writes. No secrets ever written to disk/logs.
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../..");
export const WORKSPACE = join(REPO_ROOT, "migration", "antique-split");
export const RAW_DIR = join(WORKSPACE, "raw");
export const NORM_DIR = join(WORKSPACE, "normalized");
export const MANIFEST_DIR = join(WORKSPACE, "manifests");
export const REPORT_DIR = join(WORKSPACE, "reports");

// ── Approved targets ────────────────────────────────────────────────────────
export const DEV_SUPABASE_REF = "mcgrccvvybgcozeqlisj"; // aiolly-dev — ONLY allowed ref
export const HOTEL_SLUG = "antique-split";
export const IMPORT_VERSION = "antique-v1";

// ── env ──────────────────────────────────────────────────────────────────────
export function readEnv(key, { required = true } = {}) {
  const envPath = join(REPO_ROOT, ".env");
  const line = readFileSync(envPath, "utf8").split("\n").find((l) => l.startsWith(key + "="));
  if (!line) { if (required) throw new Error(`Missing ${key} in .env`); return undefined; }
  return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
}

/** Extract the project ref from a Supabase URL without exposing keys. */
export function supabaseRefFromUrl(url) {
  const m = /^https?:\/\/([a-z0-9]+)\.supabase\.co/.exec(url || "");
  return m ? m[1] : null;
}

/** Hard guard: throws unless the configured Supabase project is the approved DEV ref. */
export function assertDevSupabase() {
  const url = readEnv("SUPABASE_URL");
  const ref = supabaseRefFromUrl(url);
  if (ref !== DEV_SUPABASE_REF) {
    throw new Error(
      `REFUSING TO RUN: Supabase ref "${ref}" is not the approved DEV ref "${DEV_SUPABASE_REF}". ` +
      `This migration is DEV-ONLY and must never touch production Supabase.`
    );
  }
  return ref;
}

// ── Airtable READ-ONLY client ─────────────────────────────────────────────────
const AIRTABLE_BASE = "https://api.airtable.com/v0";

/**
 * The ONLY way this codebase talks to Airtable during migration. GET-only.
 * Any non-GET method throws before a request is made — the migration must never
 * mutate production Airtable under any mode.
 */
export async function airtableGet(path, { query } = {}) {
  const key = readEnv("AIRTABLE_API_KEY");
  const url = new URL(`${AIRTABLE_BASE}/${path}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, String(v));
  const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Airtable GET ${path} → ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Page through an entire Airtable table (read-only). Returns all records. */
export async function airtableListAll(baseId, tableId, { pageSize = 100 } = {}) {
  const out = [];
  let offset;
  do {
    const page = await airtableGet(`${baseId}/${encodeURIComponent(tableId)}`, {
      query: { pageSize, offset },
    });
    out.push(...(page.records ?? []));
    offset = page.offset;
  } while (offset);
  return out;
}

// ── redaction ─────────────────────────────────────────────────────────────────
// Field NAMES whose values are room access tokens — never leave raw/ (in memory only).
export const TOKEN_FIELDS = new Set(["Access Token"]);
// Field NAMES carrying guest PII — never exported to disk from PII tables.
export const PII_FIELD_HINTS = /ime|prezime|email|telefon|gost|potpis|pin|subscription|guest|phone|name/i;

/** Replace any token value with a stable, non-reversible marker for reports. */
export function tokenPresence(v) {
  return v && String(v).length > 0 ? "TOKEN_PRESENT" : "TOKEN_ABSENT";
}

// ── determinism + checksums ────────────────────────────────────────────────────
/** Stable JSON: sorted keys, arrays preserved. Deterministic across runs. */
export function stableStringify(value) {
  const seen = new WeakSet();
  const norm = (v) => {
    if (v && typeof v === "object") {
      if (seen.has(v)) return null;
      seen.add(v);
      if (Array.isArray(v)) return v.map(norm);
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
    }
    return v;
  };
  return JSON.stringify(norm(value), null, 2);
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function ensureDirs() {
  for (const d of [RAW_DIR, NORM_DIR, MANIFEST_DIR, REPORT_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

export function writeJson(path, value) {
  const text = stableStringify(value);
  writeFileSync(path, text);
  return sha256(text);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// ── Source table registry ──────────────────────────────────────────────────────
// scope: how each row maps to a tenant. content:false → count/metadata only (PII).
export const BASE_ID = "appon9UYjX6KU9cr1"; // Antique Split production base (read-only)

export const TABLES = [
  { key: "hotel",            id: "tblvDAXTN6kmeQt8o", name: "HOTELI",              slugField: "Slug",              pii: false },
  { key: "rooms",            id: "tblbHFokE9BP1rkOf", name: "SOBE",                slugField: "Hotel Slug (text)", pii: false },
  { key: "room_guide",       id: "tbls3oojfqN8pyYoJ", name: "ROOM GUIDE",          slugField: null,                pii: false, hasToken: true },
  { key: "services",         id: "tbloZwmqS0vqrCSL9", name: "SERVICES",            slugField: "Hotel Slug (text)", pii: false },
  { key: "services_out",     id: "tblTu1AeUPaS7RN77", name: "SERVICES (Out)",      slugField: null,                pii: false },
  { key: "poi",              id: "tbl5mNNhWjuFMOJva", name: "POI",                 slugField: null,                pii: false },
  { key: "routes",           id: "tbl1IWdCiWIUqrtkH", name: "ROUTES",              slugField: null,                pii: false },
  { key: "partners",         id: "tblYvQnrS4Z70x7hM", name: "PARTNERS",            slugField: "Hotel Slug",        pii: false },
  { key: "events",           id: "tbl90CM2v6XY7xNYv", name: "EVENTS",              slugField: "HotelSlug",         pii: false },
  { key: "novosti",          id: "tblscuDZTJ8LEut5j", name: "NOVOSTI",             slugField: "HotelSlug",         pii: false },
  { key: "split_today",      id: "tbl3zaxUDfURrvHR6", name: "Split Today Events",  slugField: null,                pii: false },
  { key: "ai_intent",        id: "tbl6fZUo99dd2Y5kw", name: "AI_INTENT_PATTERNS",  slugField: null,                pii: false },
  { key: "ai_output_rules",  id: "tbl2cHJu94SCHmOtk", name: "AI_OUTPUT_RULES",     slugField: null,                pii: false },
  { key: "ai_context",       id: "tbl9PF8mcEwOG7iGh", name: "AI_CONTEXT",          slugField: null,                pii: false },
  { key: "ai_disambig",      id: "tblPJhMzIbjzpE1j5", name: "AI_DISAMBIGUATION",   slugField: null,                pii: false },
  { key: "ai_fallback",      id: "tblpwW4XF9XUbsS51", name: "AI_FALLBACK",         slugField: null,                pii: false },
  { key: "ai_slug_scope",    id: "tblzcRXlr7kf0kgSj", name: "AI_SLUG_SCOPE",       slugField: "Slug",              pii: false },
  { key: "unanswered",       id: "tblD97FfQMkkXSEW3", name: "UNANSWERED_QUESTIONS",slugField: "Hotel Slug",        pii: false, aiContentOnly: true },
  // PII / guest tables — COUNT ONLY, content never written to disk.
  { key: "guests",           id: "tblzuEUTUpCQiNfPd", name: "GUESTS",              slugField: "HotelSlug",         pii: true },
  { key: "stays",            id: "tbl1J16CqhqYopPJO", name: "STAYS",               slugField: "HotelSlug",         pii: true },
  { key: "privole",          id: "tblJLmNCN8Ma1MGR0", name: "PRIVOLE",             slugField: "HotelSlug",         pii: true },
  { key: "requests",         id: "tblYdzb9pRBFTRKFL", name: "REQUESTS",            slugField: "Hotel Slug",        pii: true },
  { key: "feedback",         id: "tblG7coH5JjaaWtJo", name: "FEEDBACK",            slugField: "HotelSlug",         pii: true },
  { key: "push",             id: "tblmy7YXI2dT4REbz", name: "PUSH_SUBSCRIPTIONS",  slugField: "HotelSlug",         pii: true },
  { key: "ai_logs",          id: "tbl3wXLAUoYamQ91Z", name: "AI_RESPONSE_LOGS",    slugField: "Hotel Slug",        pii: true },
];

export function tableByKey(key) {
  const t = TABLES.find((x) => x.key === key);
  if (!t) throw new Error(`Unknown table key: ${key}`);
  return t;
}

export function nowIso(argTs) {
  // Date.now is unavailable in workflow scripts; standalone node scripts have it.
  return argTs || new Date().toISOString();
}
