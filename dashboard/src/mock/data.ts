import type {
  AppNotification,
  CommandAction,
  Hotel,
  SearchItem,
  Session,
  User,
} from "./types";

/**
 * In-memory demo content for Sprint 1. Clearly synthetic — no real guests,
 * emails, tokens, or hotel data. Timestamps are expressed as "minutes ago"
 * offsets and converted to ISO at call time (client-side) to avoid SSR/CSR
 * hydration drift.
 */

export const DEMO_USER: User = {
  id: "u_demo",
  name: "Ivan Marić",
  email: "manager@demo-hotel.example",
  isPlatformAdmin: false,
};

export const DEMO_SESSION: Session = {
  user: DEMO_USER,
  token: "demo-session-token",
};

export const HOTELS: Hotel[] = [
  { id: "h_demo", name: "Demo Hotel", slug: "demo-hotel", destination: "Split", environment: "dev", role: "hotel_admin" },
  { id: "h_antique", name: "Antique Split", slug: "antique-split", destination: "Split", environment: "dev", role: "hotel_admin" },
  { id: "h_riva", name: "Riva Boutique", slug: "riva-boutique", destination: "Split", environment: "dev", role: "reception" },
];

/** Notifications with tiers (Design System §14). offset = minutes ago. */
export const NOTIFICATIONS: (Omit<AppNotification, "createdAt"> & { minutesAgo: number })[] = [
  { id: "n1", tier: "critical", title: "Critical fact expiring", body: "Check‑in time is set to expire in 2 days.", read: false, minutesAgo: 24, href: "/content/rooms" },
  { id: "n2", tier: "task", title: "Request assigned to you", body: "Extra towels — Room 204.", read: false, minutesAgo: 41, href: "/reception" },
  { id: "n3", tier: "warning", title: "Knowledge gap trending", body: "‘Gluten‑free’ asked 6× this week with no answer.", read: false, minutesAgo: 120, href: "/ai" },
  { id: "n4", tier: "success", title: "Published to guests", body: "Airport Transfer price updated to €45.", read: true, minutesAgo: 190, href: "/content/services" },
  { id: "n5", tier: "info", title: "Campaign scheduled", body: "‘Summer at Demo Hotel’ scheduled for Thu 09:00.", read: true, minutesAgo: 300, href: "/newsletter" },
];

/** Universal-search corpus — humans see names/rooms, never IDs. */
export const SEARCH_ITEMS: SearchItem[] = [
  { id: "s1", kind: "room", title: "Room 201", subtitle: "Deluxe · Sea view · occupied", href: "/content/rooms" },
  { id: "s2", kind: "room", title: "Room 204", subtitle: "Standard · arriving today", href: "/content/rooms" },
  { id: "s3", kind: "service", title: "Breakfast", subtitle: "07:00–10:30 · Breakfast & Food", href: "/content/services" },
  { id: "s4", kind: "service", title: "Airport Transfer", subtitle: "€45 · Transport & Parking", href: "/content/services" },
  { id: "s5", kind: "knowledge", title: "Check‑in Policy", subtitle: "Critical · published", href: "/content/knowledge" },
  { id: "s6", kind: "knowledge", title: "Wi‑Fi Access", subtitle: "Published · AI‑visible", href: "/content/knowledge" },
  { id: "s7", kind: "guest", title: "John Smith", subtitle: "Arriving today · Room 204", href: "/guests" },
  { id: "s8", kind: "poi", title: "Diocletian’s Palace", subtitle: "Landmark · featured", href: "/content/poi" },
  { id: "s9", kind: "poi", title: "Peristyle", subtitle: "Landmark · shared", href: "/content/poi" },
  { id: "s10", kind: "campaign", title: "Summer at Demo Hotel", subtitle: "Scheduled · Thu 09:00", href: "/newsletter" },
  { id: "s11", kind: "service", title: "Minibar", subtitle: "Room Comfort", href: "/content/services" },
  { id: "s12", kind: "page", title: "AI Quality", subtitle: "Analytics", href: "/ai" },
];

/** Quick create/act commands (Design System §14). */
export const COMMAND_ACTIONS: CommandAction[] = [
  { id: "c1", label: "New request", group: "Create", icon: "ConciergeBell", href: "/reception" },
  { id: "c2", label: "New knowledge article", group: "Create", icon: "BookOpen", href: "/content/knowledge" },
  { id: "c3", label: "New room", group: "Create", icon: "BedDouble", href: "/content/rooms" },
  { id: "c4", label: "New campaign", group: "Create", icon: "Send", href: "/newsletter" },
  { id: "c5", label: "Upload media", group: "Create", icon: "ImagePlus", href: "/assets" },
  { id: "c6", label: "Invite staff", group: "Create", icon: "UserPlus", href: "/settings" },
  { id: "a1", label: "Review AI Quality", group: "Act", icon: "Sparkles", href: "/ai" },
  { id: "a2", label: "Today’s arrivals", group: "Act", icon: "LogIn", href: "/reception" },
  { id: "a3", label: "Publish waiting drafts", group: "Act", icon: "UploadCloud", href: "/content" },
];
