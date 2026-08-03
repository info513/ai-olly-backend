// ============================================================================
// Migration workspace — SERVER-ONLY authorization + guards (DEV-ONLY tool).
// ----------------------------------------------------------------------------
// Shared by /api/migration/* route handlers. Never imported by client code.
//   • requirePlatformAdmin — verifies the caller's JWT and their is_platform_admin
//     flag (RLS: a user reads only their own profile row). Hotel roles are denied.
//   • assertDevRef — refuses to operate unless the configured Supabase project is
//     the approved aiolly-dev ref.
//   • repoRoot / migration paths — resolve the repo workspace from the dashboard cwd.
// Airtable and service-role credentials live in the repo .env and are only read by
// the migration scripts this server spawns — they are NEVER returned to the browser.
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { resolve, join } from "node:path";

export const DEV_SUPABASE_REF = "mcgrccvvybgcozeqlisj"; // aiolly-dev — ONLY allowed ref

export function supabaseRef(url: string | undefined): string | null {
  const m = /^https?:\/\/([a-z0-9]+)\.supabase\.co/.exec(url ?? "");
  return m ? m[1] : null;
}

/** Throws (as an HTTP-shaped object) unless the target Supabase project is aiolly-dev. */
export function assertDevRef(): { ok: true; ref: string } {
  const ref = supabaseRef(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (ref !== DEV_SUPABASE_REF) {
    const err: any = new Error(`Migration tools are DEV-only. Refusing ref "${ref}".`);
    err.status = 403;
    throw err;
  }
  return { ok: true, ref };
}

export interface Caller { userId: string; email: string | null }

/** Verify the bearer JWT and require is_platform_admin. Hotel roles / anon are denied. */
export async function requirePlatformAdmin(req: Request): Promise<Caller> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) { const e: any = new Error("Server not configured."); e.status = 500; throw e; }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!token) { const e: any = new Error("Not authenticated."); e.status = 401; throw e; }

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData.user) { const e: any = new Error("Not authenticated."); e.status = 401; throw e; }
  const { data: prof } = await sb.from("profiles").select("is_platform_admin, email").eq("user_id", userData.user.id).maybeSingle();
  if (!prof?.is_platform_admin) { const e: any = new Error("Platform admin only."); e.status = 403; throw e; }
  return { userId: userData.user.id, email: prof.email ?? userData.user.email ?? null };
}

// ── repo paths (dashboard cwd → repo root) ────────────────────────────────────
export const repoRoot = () => resolve(process.cwd(), "..");
export const migrationDir = () => join(repoRoot(), "migration", "antique-split");
export const scriptFor = (name: string) => join(repoRoot(), "scripts", "migration", name);

/** Redact anything token-like from spawned-script output before returning to the browser. */
export function redactLog(s: string): string {
  return s.replace(/[A-Za-z0-9_-]{32,}/g, "‹redacted›").slice(-4000);
}
