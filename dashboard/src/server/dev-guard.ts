// ============================================================================
// Shared DEV-ONLY route guard (S-09). Reusable across dev/tooling endpoints
// (migration workspace, newsletter webhook-dev) that hold service-role side
// effects and must NEVER run in production or against a non-dev Supabase project.
//   • refuses unless the configured Supabase project is the approved aiolly-dev ref
//   • refuses when NODE_ENV/VERCEL_ENV indicates production
// Throws an HTTP-shaped error ({status}) BEFORE any service-role work, so a failed
// guard can produce no side effect. Server-only module — never imported by client code.
// ============================================================================

export const DEV_SUPABASE_REF = "mcgrccvvybgcozeqlisj"; // aiolly-dev — the ONLY allowed ref

export function supabaseRef(url: string | undefined): string | null {
  const m = /^https?:\/\/([a-z0-9]+)\.supabase\.co/.exec(url ?? "");
  return m ? m[1] : null;
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

/** Throws (HTTP-shaped) unless the target Supabase project is aiolly-dev AND the
 *  runtime is not production. Call this FIRST, before any service-role client. */
export function assertDevProject(): { ok: true; ref: string } {
  const ref = supabaseRef(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (isProductionRuntime()) {
    const err: any = new Error("This endpoint is DEV-only and cannot run in production.");
    err.status = 403; throw err;
  }
  if (ref !== DEV_SUPABASE_REF) {
    const err: any = new Error(`This endpoint is DEV-only. Refusing Supabase ref "${ref}".`);
    err.status = 403; throw err;
  }
  return { ok: true, ref };
}
