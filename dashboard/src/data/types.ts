/**
 * Domain models for the Content module. Field names mirror the Supabase columns
 * (the Room Guide uses an explicit-column model, so mirroring keeps forms honest
 * and avoids a lossy mapping layer). UI-friendly derivations (labels, effective
 * flags) live in helpers, not by renaming every column.
 */

export type ContentStatus = "draft" | "preview" | "published" | "archived";
export type ServiceSource = "platform" | "hotel" | "override";

// ── Structured content blocks (validated by platform.is_valid_service_body) ──
export type Block =
  | { type: "paragraph"; text?: string }
  | { type: "heading"; level?: number; text?: string }
  | { type: "bullet_list"; items?: string[] }
  | { type: "price_list"; items?: { label?: string; price?: string; note?: string }[] }
  | { type: "callout"; style?: "info" | "warning"; text?: string }
  | { type: "link"; label?: string; url?: string }
  | { type: "contact_action"; action?: "call" | "email" | "whatsapp"; value?: string; label?: string }
  | { type: "divider" };

export interface BlockBody {
  version: number;
  blocks: Block[];
}

// ── Rooms ─────────────────────────────────────────────────────────────────
export interface RoomType {
  id: string;
  hotel_id: string;
  name: string;
  slug: string;
  description: string | null;
  active: boolean;
  sort_order: number;
  default_capacity: number | null;
  default_bed_configuration: string | null;
  default_extra_bed_available: boolean | null;
  wifi_instructions: string | null;
  ac_instructions: string | null;
  tv_instructions: string | null;
  safe_instructions: string | null;
  smart_glass: boolean | null;
  smart_glass_instructions: string | null;
  window_instructions: string | null;
  underfloor_heating: boolean | null;
  room_features: string[] | null;
  room_notes: string[] | null;
  ai_welcome: string | null;
  minibar_available: boolean | null;
  kettle_available: boolean | null;
  blackout_system: boolean | null;
  toiletries: string | null;
  updated_at: string;
  roomCount?: number;
}

/** Rooms — access_token is intentionally NEVER selected (column-protected). */
export interface Room {
  id: string;
  hotel_id: string;
  room_type_id: string;
  room_number: string;
  active: boolean;
  floor: number | null;
  capacity_override: number | null;
  bed_configuration_override: string | null;
  view_description_override: string | null;
  smart_glass_override: boolean | null;
  smart_glass_instructions_override: string | null;
  window_mode_override: string | null;
  underfloor_heating_override: boolean | null;
  air_conditioning_note_override: string | null;
  extra_bed_available_override: boolean | null;
  room_features_override: string[] | null;
  room_notes_override: string[] | null;
  ai_welcome_override: string | null;
  updated_at: string;
}

/** The resolved (guest-facing) room, from the resolved_rooms view. No token. */
export interface ResolvedRoom {
  room_id: string;
  hotel_id: string;
  room_type_id: string;
  room_number: string;
  active: boolean;
  floor: number | null;
  room_type_name: string;
  room_type_slug: string;
  capacity: number | null;
  bed_configuration: string | null;
  view_description: string | null;
  smart_glass: boolean | null;
  smart_glass_instructions: string | null;
  window_instructions: string | null;
  underfloor_heating: boolean | null;
  ac_instructions: string | null;
  extra_bed_available: boolean | null;
  room_features: string[] | null;
  room_notes: string[] | null;
  ai_welcome: string | null;
  wifi_instructions: string | null;
  tv_instructions: string | null;
  safe_instructions: string | null;
  minibar_available: boolean | null;
  kettle_available: boolean | null;
  blackout_system: boolean | null;
  toiletries: string | null;
}

// ── Services ────────────────────────────────────────────────────────────────
export interface ServiceCategory {
  id: string;
  hotel_id: string | null; // null = platform default
  key: string;
  name: string;
  sort_order: number;
  active: boolean;
  serviceCount?: number;
}

export interface HotelService {
  id: string;
  hotel_id: string | null;
  category_id: string;
  key: string;
  title: string;
  short_description: string | null;
  body_content: BlockBody | null;
  status: ContentStatus;
  active: boolean;
  visible_in_pwa: boolean;
  visible_in_web: boolean;
  available_to_ai: boolean;
  sort_order: number;
  is_critical: boolean;
  source_type: ServiceSource;
  override_of_service_id: string | null;
  published_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
  updated_at: string;
  categoryName?: string;
}

export interface ResolvedService {
  service_id: string;
  source: ServiceSource;
  category_id: string | null;
  category_key: string | null;
  category_name: string | null;
  key: string;
  title: string;
  short_description: string | null;
  body_content: BlockBody | null;
  is_critical: boolean;
  featured: boolean;
  sort_order: number;
  visible_in_pwa: boolean;
  visible_in_web: boolean;
  available_to_ai: boolean;
  valid_from: string | null;
  valid_to: string | null;
  published_at: string | null;
}

export interface ServiceVersion {
  id: string;
  version_number: number;
  status: ContentStatus;
  change_summary: string | null;
  created_by: string | null;
  published_at: string | null;
  created_at: string;
  snapshot: Record<string, any>;
}

export interface ContentSummary {
  roomTypeCount: number;
  roomCount: number;
  serviceCount: number;
  draftsWaiting: number;
  criticalNeedsAttention: number;
  recentlyPublished: { id: string; title: string; published_at: string | null }[];
}
