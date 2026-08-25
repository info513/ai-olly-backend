// ============================================================================
// PMS integration — SERVER-ONLY authorization. Shared by /api/pms/* handlers.
// Never imported by client code. A PMS integration may be administered ONLY by a
// platform_admin or an ACTIVE hotel_admin of the target hotel (reception / editor /
// marketing / read_only are denied) — the same boundary the RLS policies enforce.
// The webhook endpoint authenticates by shared-token hash instead (see service).
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { assertDevProject } from "@/server/dev-guard";

export { assertDevProject as assertDevRef };

export interface PmsCaller { userId: string; email: string | null; isPlatformAdmin: boolean }

function bearer(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
}

/** Verify the JWT and require platform_admin OR active hotel_admin of `hotelId`. */
export async function requirePmsAdmin(req: Request, hotelId: string): Promise<PmsCaller> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) { const e: any = new Error("Server not configured."); e.status = 500; throw e; }
  if (!hotelId) { const e: any = new Error("hotelId required."); e.status = 400; throw e; }
  const token = bearer(req);
  if (!token) { const e: any = new Error("Not authenticated."); e.status = 401; throw e; }

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData.user) { const e: any = new Error("Not authenticated."); e.status = 401; throw e; }
  const uid = userData.user.id;

  const { data: prof } = await sb.from("profiles").select("is_platform_admin, email").eq("user_id", uid).maybeSingle();
  const isPlatformAdmin = !!prof?.is_platform_admin;
  if (!isPlatformAdmin) {
    const { data: m } = await sb.from("hotel_memberships").select("role, status").eq("hotel_id", hotelId).eq("user_id", uid).maybeSingle();
    if (!m || m.status !== "active" || m.role !== "hotel_admin") {
      const e: any = new Error("Hotel admin (or platform admin) only."); e.status = 403; throw e;
    }
  }
  return { userId: uid, email: prof?.email ?? userData.user.email ?? null, isPlatformAdmin };
}
