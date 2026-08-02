"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client — uses the PUBLIC anon key (safe to ship to the
 * client by design) plus the signed-in user's JWT. Every read/write is therefore
 * subject to Row Level Security. The service-role key is NEVER referenced here.
 * Session persists in localStorage and auto-refreshes.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let _client: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (_client) return _client;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Create dashboard/.env.local."
    );
  }
  _client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "aiolly.auth",
    },
  });
  return _client;
}

export const ENVIRONMENT = (process.env.NEXT_PUBLIC_ENVIRONMENT as "dev" | "prod") ?? "dev";
