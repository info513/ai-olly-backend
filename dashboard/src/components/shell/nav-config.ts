import {
  Home,
  FileText,
  Sparkles,
  ConciergeBell,
  Users,
  Images,
  Send,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** false = placeholder module for a later sprint (Sprint 1 builds only Home) */
  ready: boolean;
}

/** Information Architecture (Master Plan §3) — modules only; subsections land later. */
export const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/home", icon: Home, ready: true },
  { label: "Content", href: "/content", icon: FileText, ready: false },
  { label: "AI", href: "/ai", icon: Sparkles, ready: true },
  { label: "Reception", href: "/reception", icon: ConciergeBell, ready: false },
  { label: "Guests", href: "/guests", icon: Users, ready: false },
  { label: "Assets", href: "/assets", icon: Images, ready: false },
  { label: "Newsletter", href: "/newsletter", icon: Send, ready: false },
  { label: "Analytics", href: "/analytics", icon: BarChart3, ready: false },
  { label: "Settings", href: "/settings", icon: Settings, ready: false },
];
