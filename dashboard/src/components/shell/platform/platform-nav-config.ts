import {
  LayoutDashboard, MapPin, Landmark, Route, Sparkles, CalendarDays, Rss, Images,
  Brain, Languages, HeartPulse, Settings, type LucideIcon,
} from "lucide-react";

export interface PlatformNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** false = shell placeholder ("Coming in next phase") built in a later Platform CMS phase */
  ready: boolean;
}

/** Platform CMS navigation (AI_OLLY_PLATFORM_CMS_ARCHITECTURE.md §12). Phase 1 ships only
 *  Dashboard + Destinations; the rest are coming-soon placeholders. */
export const PLATFORM_NAV: PlatformNavItem[] = [
  { label: "Dashboard", href: "/platform", icon: LayoutDashboard, ready: true },
  { label: "Destinations", href: "/platform/destinations", icon: MapPin, ready: true },
  { label: "POIs", href: "/platform/pois", icon: Landmark, ready: true },
  { label: "Routes", href: "/platform/routes", icon: Route, ready: true },
  { label: "Whispers", href: "/platform/whispers", icon: Sparkles, ready: true },
  { label: "Events", href: "/platform/events", icon: CalendarDays, ready: true },
  { label: "Live Feed", href: "/platform/live-feed", icon: Rss, ready: true },
  { label: "Media", href: "/platform/media", icon: Images, ready: false },
  { label: "AI Knowledge", href: "/platform/ai-knowledge", icon: Brain, ready: false },
  { label: "Translations", href: "/platform/translations", icon: Languages, ready: false },
  { label: "Content Health", href: "/platform/content-health", icon: HeartPulse, ready: false },
  { label: "Settings", href: "/platform/settings", icon: Settings, ready: false },
];

/** Look up a nav item by its single-segment module key (for the catch-all placeholder). */
export const platformModule = (key: string) =>
  PLATFORM_NAV.find((n) => n.href === `/platform/${key}`);
