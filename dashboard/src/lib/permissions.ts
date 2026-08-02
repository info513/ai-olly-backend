/**
 * Client-side permission MAP — mirrors the database RLS role model. This decides
 * only what the UI *offers* (which modules to show). It is NOT the security
 * boundary: every real read/write is enforced by Supabase RLS using the user's
 * JWT. The role itself is resolved from Supabase (profile + active membership),
 * never trusted from the client.
 */

export type Role =
  | "platform_admin"
  | "hotel_admin"
  | "reception"
  | "editor"
  | "marketing"
  | "read_only";

export const ROLE_LABEL: Record<Role, string> = {
  platform_admin: "Platform admin",
  hotel_admin: "Hotel admin",
  reception: "Reception",
  editor: "Editor",
  marketing: "Marketing",
  read_only: "Read only",
};

/** Which roles may SEE each module (Master Plan §13). Hidden entirely otherwise. */
export const MODULE_ACCESS: Record<string, Role[]> = {
  home: ["platform_admin", "hotel_admin", "reception", "editor", "marketing", "read_only"],
  content: ["platform_admin", "hotel_admin", "editor", "read_only"],
  ai: ["platform_admin", "hotel_admin", "editor", "read_only"],
  reception: ["platform_admin", "hotel_admin", "reception"],
  guests: ["platform_admin", "hotel_admin", "reception"],
  assets: ["platform_admin", "hotel_admin", "editor", "marketing", "reception", "read_only"],
  newsletter: ["platform_admin", "hotel_admin", "marketing"],
  analytics: ["platform_admin", "hotel_admin", "reception", "editor", "marketing", "read_only"],
  settings: ["platform_admin", "hotel_admin"],
};

/** The effective role: platform admins outrank any per-hotel membership. */
export function effectiveRole(role: Role | null, isPlatformAdmin: boolean): Role | null {
  if (isPlatformAdmin) return "platform_admin";
  return role;
}

export function canAccessModule(role: Role | null, moduleKey: string): boolean {
  if (!role) return false;
  return MODULE_ACCESS[moduleKey]?.includes(role) ?? false;
}

/** First path segment → module key ("/content/rooms" -> "content", "/" -> "home"). */
export function moduleKeyFromPath(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean)[0];
  return seg || "home";
}
