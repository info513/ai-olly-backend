import {
  Home,
  CalendarClock,
  Users,
  BookOpen,
  Sparkles,
  Megaphone,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavChild {
  label: string;
  href: string;
}

export interface NavGroup {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Secondary destinations under this job. Each reuses an existing route; a child
   *  is shown only when the role can access its route (first path segment = module key). */
  children?: NavChild[];
  /** false = not built yet (shows a "soon" badge). */
  ready?: boolean;
}

/**
 * Hotel workspace primary navigation — organized around JOBS, not database domains
 * (IA simplification). Each group's `href` is its landing; `children` are secondary
 * destinations that reuse existing routes. Visibility is role-aware: a group appears
 * when the role can reach its landing OR at least one child. Old routes are preserved —
 * items removed from the primary rail (Stays, Consent, Assets, Presentation, …) remain
 * reachable here as children and via deep links.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Home",
    href: "/home",
    icon: Home,
    ready: true,
  },
  {
    label: "Today",
    href: "/reception",
    icon: CalendarClock,
    ready: true,
    children: [
      { label: "Requests", href: "/reception/requests" },
      { label: "Feedback", href: "/reception/feedback" },
    ],
  },
  {
    label: "Guests",
    href: "/guests",
    icon: Users,
    ready: true,
    children: [
      { label: "Stays", href: "/stays" },
      { label: "Consent", href: "/consent" },
    ],
  },
  {
    label: "Hotel Content",
    href: "/content",
    icon: BookOpen,
    ready: true,
    children: [
      { label: "Rooms", href: "/content/rooms" },
      { label: "Services", href: "/content/services" },
      { label: "Photos & Media", href: "/assets" },
      { label: "Recommendations", href: "/presentation" },
    ],
  },
  {
    label: "Olly",
    href: "/ai",
    icon: Sparkles,
    ready: true,
    children: [
      { label: "What Olly knows", href: "/ai/knowledge" },
      { label: "Questions Olly couldn't answer", href: "/ai/unanswered" },
      { label: "Try Olly", href: "/ai/preview" },
    ],
  },
  {
    label: "Marketing",
    href: "/newsletter",
    icon: Megaphone,
    ready: true,
    children: [
      { label: "Campaigns", href: "/newsletter/campaigns" },
      { label: "Contacts", href: "/newsletter/subscribers" },
      { label: "Audiences", href: "/newsletter/segments" },
      { label: "Email designs", href: "/newsletter/templates" },
    ],
  },
  {
    label: "Insights",
    href: "/analytics",
    icon: BarChart3,
    ready: true,
    children: [
      { label: "Hotel Health", href: "/analytics/health" },
    ],
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    ready: false,
  },
];

/** Back-compat alias (some call sites may still import NAV_ITEMS). */
export const NAV_ITEMS = NAV_GROUPS;
