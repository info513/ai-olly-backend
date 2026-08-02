/**
 * Typed contracts for the Sprint-1 mock layer.
 *
 * These shapes intentionally mirror the real Supabase model (roles, hotels,
 * memberships) so that swapping the mock provider for `@supabase/supabase-js`
 * in a later sprint is a provider change, not a rewrite. No backend is called
 * in Sprint 1 — everything resolves from in-memory demo data.
 */

export type Role =
  | "platform_admin"
  | "hotel_admin"
  | "reception"
  | "editor"
  | "marketing"
  | "read_only";

export type Environment = "dev" | "prod";

export interface Hotel {
  id: string;
  name: string;
  slug: string;
  destination: string;
  environment: Environment;
  /** the signed-in user's role at this hotel */
  role: Role;
}

export interface User {
  id: string;
  name: string;
  email: string;
  isPlatformAdmin: boolean;
}

export interface Session {
  user: User;
  /** opaque token placeholder — never a real credential */
  token: string;
}

export type NotificationTier = "critical" | "warning" | "task" | "info" | "success";

export interface AppNotification {
  id: string;
  tier: NotificationTier;
  title: string;
  body: string;
  createdAt: string; // ISO
  read: boolean;
  href?: string;
}

export type SearchKind = "room" | "service" | "guest" | "knowledge" | "poi" | "campaign" | "page";

export interface SearchItem {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle?: string;
  href: string;
}

export interface CommandAction {
  id: string;
  label: string;
  group: "Jump" | "Create" | "Act" | "Go to";
  icon: string; // lucide icon name (resolved in UI)
  shortcut?: string;
  href?: string;
}

export interface StayLite {
  id: string;
  guestFirstName: string;
  room: string;
  time: string; // "14:00"
  note?: string;
}

export interface RequestLite {
  id: string;
  title: string;
  room: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "new" | "acknowledged" | "in_progress";
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  actor: string;
  action: string;
  target: string;
  createdAt: string;
  tier: NotificationTier;
}

export interface HomeSummary {
  hotelId: string;
  arrivals: StayLite[];
  departures: StayLite[];
  openRequests: RequestLite[];
  aiCoveragePct: number; // 0..100
  aiHandoffPct: number;
  knowledgeCompletenessPct: number;
  draftsWaiting: number;
  feedbackAverage: number; // 0..5
  recentActivity: ActivityItem[];
}
