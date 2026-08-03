"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BedDouble, ConciergeBell, BookOpen, Sparkles, CalendarCheck, FileSignature,
  UserPlus, Users, MessageSquare, LogIn, LogOut, Search, CornerDownLeft, PlayCircle,
  Images, Upload, ImageIcon, FileText, Link2Off, Send, Mail, Filter, ShieldAlert,
  HeartPulse, Activity, RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { useCommand } from "@/providers/command-provider";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useReceptionSearch, type SearchResultKind } from "@/data/search";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";

const KIND_ICON: Record<SearchResultKind, LucideIcon> = {
  room: BedDouble, guest: Users, stay: CalendarCheck, request: ConciergeBell, consent: FileSignature, feedback: MessageSquare, asset: Images,
  subscriber: Users, segment: Filter, template: Mail, campaign: Send,
};

interface Action { id: string; label: string; icon: LucideIcon; href: string; group: "Create" | "Go"; module: string }
const ACTIONS: Action[] = [
  { id: "new-stay", label: "New stay", icon: CalendarCheck, href: "/stays/new", group: "Create", module: "stays" },
  { id: "new-request", label: "New request", icon: ConciergeBell, href: "/reception/requests", group: "Create", module: "reception" },
  { id: "new-guest", label: "Find or add guest", icon: UserPlus, href: "/guests", group: "Create", module: "guests" },
  { id: "capture-consent", label: "Capture consent", icon: FileSignature, href: "/consent", group: "Create", module: "consent" },
  { id: "add-knowledge", label: "Add AI answer", icon: Sparkles, href: "/ai/knowledge/new", group: "Create", module: "ai" },
  { id: "upload-asset", label: "Upload asset", icon: Upload, href: "/assets/upload", group: "Create", module: "assets" },
  { id: "new-campaign", label: "New campaign", icon: Send, href: "/newsletter/campaigns/new", group: "Create", module: "newsletter" },
  { id: "create-segment", label: "Create segment", icon: Filter, href: "/newsletter/segments", group: "Create", module: "newsletter" },
  { id: "create-template", label: "Create email template", icon: Mail, href: "/newsletter/templates/new", group: "Create", module: "newsletter" },
  { id: "find-subscriber", label: "Find subscriber", icon: Users, href: "/newsletter/subscribers", group: "Create", module: "newsletter" },
  { id: "arrivals", label: "View arrivals", icon: LogIn, href: "/reception#arrivals", group: "Go", module: "reception" },
  { id: "departures", label: "View departures", icon: LogOut, href: "/reception#departures", group: "Go", module: "reception" },
  { id: "requests", label: "All requests", icon: ConciergeBell, href: "/reception/requests", group: "Go", module: "reception" },
  { id: "guests", label: "Guests", icon: Users, href: "/guests", group: "Go", module: "guests" },
  { id: "stays", label: "Stays", icon: CalendarCheck, href: "/stays", group: "Go", module: "stays" },
  { id: "feedback", label: "Feedback", icon: MessageSquare, href: "/reception/feedback", group: "Go", module: "reception" },
  { id: "test-ai", label: "Test the AI", icon: PlayCircle, href: "/ai/preview", group: "Go", module: "ai" },
  { id: "knowledge", label: "AI knowledge", icon: BookOpen, href: "/ai/knowledge", group: "Go", module: "ai" },
  { id: "find-image", label: "Find image", icon: ImageIcon, href: "/assets/images", group: "Go", module: "assets" },
  { id: "find-document", label: "Find document", icon: FileText, href: "/assets/documents", group: "Go", module: "assets" },
  { id: "unused-assets", label: "Unused assets", icon: Link2Off, href: "/assets/usage?filter=unused", group: "Go", module: "assets" },
  { id: "missing-alt", label: "Assets missing alt text", icon: ImageIcon, href: "/assets/images?filter=missing-alt", group: "Go", module: "assets" },
  { id: "consent-docs", label: "Consent documents", icon: FileSignature, href: "/assets/documents", group: "Go", module: "assets" },
  { id: "scheduled-campaigns", label: "Scheduled campaigns", icon: Send, href: "/newsletter/campaigns?filter=scheduled", group: "Go", module: "newsletter" },
  { id: "consent-issues", label: "Consent issues", icon: ShieldAlert, href: "/newsletter/subscribers?filter=consent-missing", group: "Go", module: "newsletter" },
  { id: "hotel-health", label: "Open Hotel Health", icon: HeartPulse, href: "/analytics/health", group: "Go", module: "analytics" },
  { id: "analytics", label: "Analytics overview", icon: Activity, href: "/analytics", group: "Go", module: "analytics" },
  { id: "ai-handoffs", label: "View AI handoffs", icon: Activity, href: "/analytics/ai", group: "Go", module: "analytics" },
  { id: "refresh-analytics", label: "Refresh analytics (dev)", icon: RefreshCw, href: "/analytics/health", group: "Go", module: "analytics" },
];

export function CommandPalette() {
  const { open, setOpen } = useCommand();
  const { currentHotel } = useHotel();
  const { can } = usePermissions();
  const [query, setQuery] = React.useState("");
  const router = useRouter();
  const { data: results = [] } = useReceptionSearch(query, currentHotel?.id, open);

  const go = (href: string) => { setOpen(false); setQuery(""); router.push(href); };

  const actions = ACTIONS.filter((a) => can(a.module));
  const filteredActions = query ? actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase())) : actions;

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search rooms, guests, requests…  or run a command" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No results. Try a room number, a guest name, or a request.</CommandEmpty>

        {results.length > 0 && (
          <CommandGroup heading="Jump to">
            {results.map((r) => {
              const Icon = KIND_ICON[r.kind];
              return (
                <CommandItem key={`${r.kind}-${r.id}`} value={`jump-${r.kind}-${r.id}`} onSelect={() => go(r.href)}>
                  <Icon className="h-4 w-4 text-ink-tertiary" />
                  <span className="flex-1"><span className="text-ink-primary">{r.title}</span>{r.subtitle && <span className="ml-2 text-[12px] text-ink-tertiary">{r.subtitle}</span>}</span>
                  <CornerDownLeft className="h-3.5 w-3.5 text-ink-tertiary opacity-0 group-data-[selected=true]:opacity-100" />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {(["Create", "Go"] as const).map((group) => {
          const items = filteredActions.filter((a) => a.group === group);
          if (!items.length) return null;
          return (
            <CommandGroup key={group} heading={group}>
              {items.map((a) => (
                <CommandItem key={a.id} value={`act-${a.id}`} onSelect={() => go(a.href)}>
                  <a.icon className="h-4 w-4 text-ink-tertiary" />
                  <span className="flex-1 text-ink-primary">{a.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
      <div className="flex items-center justify-between border-t border-border-subtle px-3 py-2 text-[11px] text-ink-tertiary">
        <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> to open<span className="mx-1">·</span><Kbd>esc</Kbd> to close</span>
        <span>AI OLLY</span>
      </div>
    </CommandDialog>
  );
}
