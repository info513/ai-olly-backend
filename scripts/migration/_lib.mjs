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
import { resolveMigrationTarget, DEFAULT_TARGET } from "./targets.mjs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../..");

// ── Active target (Part 11) ───────────────────────────────────────────────────
// Selected by the MIGRATION_TARGET env var; defaults to antique-split so the
// existing pipeline is unchanged. All per-hotel specifics come from the registry.
export const TARGET = resolveMigrationTarget(process.env.MIGRATION_TARGET || DEFAULT_TARGET);
export const MIGRATION_TARGET_NAME = TARGET.name;

export const WORKSPACE = join(REPO_ROOT, "migration", TARGET.workspaceDir);
export const RAW_DIR = join(WORKSPACE, "raw");
export const NORM_DIR = join(WORKSPACE, "normalized");
export const MANIFEST_DIR = join(WORKSPACE, "manifests");
export const REPORT_DIR = join(WORKSPACE, "reports");

// ── Approved targets (from the active target; guards below are invariant) ─────
export const DEV_SUPABASE_REF = TARGET.devSupabaseRef; // aiolly-dev — ONLY allowed ref
export const HOTEL_SLUG = TARGET.hotelSlug;
export const IMPORT_VERSION = TARGET.importVersion;

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

// ── Source table registry (from the active target) ─────────────────────────────
// scope: how each row maps to a tenant. pii:true → count/metadata only (never written).
export const BASE_ID = TARGET.baseId; // production Airtable base for the target (read-only)
export const TABLES = TARGET.tables;

export function tableByKey(key) {
  const t = TABLES.find((x) => x.key === key);
  if (!t) throw new Error(`Unknown table key: ${key}`);
  return t;
}

export function nowIso(argTs) {
  // Date.now is unavailable in workflow scripts; standalone node scripts have it.
  return argTs || new Date().toISOString();
}
