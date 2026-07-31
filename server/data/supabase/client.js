// ============================================================================
// AI OLLY Platform 2.0 — Isolated Supabase client (SERVER-ONLY)
// ----------------------------------------------------------------------------
// Phase 1 foundation. This module is NOT imported by server.js and does NOT
// replace Airtable or alter any endpoint. It exists only so tooling (the
// connection health check) and future phases can obtain a Supabase client.
//
// SECURITY:
//   • Uses the SERVICE-ROLE key — this bypasses RLS and must NEVER reach any
//     browser bundle. Server-side use only.
//   • Reads all credentials from environment variables. No secrets in code.
//   • Fails loudly and clearly when configuration is missing.
// ============================================================================

import { createClient } from '@supabase/supabase-js';

// Required env vars for a server-side (service-role) client.
const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

/**
 * Returns the list of required Supabase env vars that are missing.
 * Does NOT reveal any values.
 */
export function missingSupabaseEnv() {
  return REQUIRED.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
}

/**
 * Whether the Supabase server credentials are present.
 */
export function isSupabaseConfigured() {
  return missingSupabaseEnv().length === 0;
}

let _client = null;

/**
 * Lazily create a server-side Supabase client (service role).
 * Throws a clear error (naming the missing vars, never their values) if the
 * configuration is incomplete. Never used at app boot while DATA_PROVIDER=airtable.
 */
export function getSupabaseServerClient() {
  const missing = missingSupabaseEnv();
  if (missing.length) {
    throw new Error(
      `Supabase is not configured — missing env var(s): ${missing.join(', ')}. ` +
      `Set them in .env (local) or the Render dashboard (server). See .env.example.`
    );
  }
  if (_client) return _client;
  _client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'ai-olly-platform-server' } },
    }
  );
  return _client;
}
