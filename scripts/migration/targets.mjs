// ============================================================================
// Migration TARGET registry (Part 11 — parameterization for Phase 11).
// ----------------------------------------------------------------------------
// A migration job is now parameterized by a named target: hotel slug, destination,
// Airtable base + source-table registry, Supabase DEV ref, artifact workspace, and
// import version. `_lib.mjs` resolves the active target from the MIGRATION_TARGET env
// (default "antique-split") so the existing, verified Antique pipeline is byte-for-byte
// unchanged while new hotels are added by appending a registry entry — no script edits.
//
// Invariants that DO NOT change per target (enforced in _lib.mjs, not here):
//   Airtable GET-only · aiolly-dev ref guard · PII count-only · token redaction ·
//   dry-run · idempotency · hotel-scoped rollback/reset. Adding a target never weakens these.
// ============================================================================

export const DEV_SUPABASE_REF = "mcgrccvvybgcozeqlisj"; // aiolly-dev — the ONLY allowed target ref

// ── antique-split — the first concrete configuration (pilot) ─────────────────
const ANTIQUE_SPLIT = {
  name: "antique-split",
  hotelSlug: "antique-split",
  destinationSlug: "split",       // canonical destination in aiolly-dev
  importVersion: "antique-v1",
  workspaceDir: "antique-split",  // migration/<workspaceDir>/{raw,normalized,manifests,reports}
  baseId: "appon9UYjX6KU9cr1",    // Antique Split production Airtable base (READ-ONLY)
  devSupabaseRef: DEV_SUPABASE_REF,
  tables: [
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
  ],
};

export const MIGRATION_TARGETS = {
  "antique-split": ANTIQUE_SPLIT,
  // Add future hotels here — each a new concrete configuration. Example shape:
  // "next-hotel": { name, hotelSlug, destinationSlug, importVersion, workspaceDir,
  //                 baseId, devSupabaseRef: DEV_SUPABASE_REF, tables: [...] },
};

export const DEFAULT_TARGET = "antique-split";

/** Resolve the active migration target by name (default antique-split). */
export function resolveMigrationTarget(name = DEFAULT_TARGET) {
  const t = MIGRATION_TARGETS[name];
  if (!t) {
    throw new Error(`Unknown migration target "${name}". Known: ${Object.keys(MIGRATION_TARGETS).join(", ")}`);
  }
  return t;
}
