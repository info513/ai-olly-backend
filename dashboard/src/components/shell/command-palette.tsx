"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BedDouble, ConciergeBell, BookOpen, MapPin, Send, FileText, Sparkles,
  LogIn, UploadCloud, UserPlus, ImagePlus, Search, CornerDownLeft,
  type LucideIcon,
} from "lucide-react";
import { useCommand } from "@/providers/command-provider";
import { useHotel } from "@/providers/hotel-provider";
import { useSearch } from "@/hooks/use-dashboard";
import { mockProvider } from "@/mock/provider";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import type { SearchKind } from "@/mock/types";

const KIND_ICON: Record<SearchKind, LucideIcon> = {
  room: BedDouble, service: ConciergeBell, guest: UserPlus,
  knowledge: BookOpen, poi: MapPin, campaign: Send, page: FileText,
};
const ACTION_ICON: Record<string, LucideIcon> = {
  ConciergeBell, BookOpen, BedDouble, Send, ImagePlus, UserPlus,
  Sparkles, LogIn, UploadCloud,
};

export function CommandPalette() {
  const { open, setOpen } = useCommand();
  const { currentHotel } = useHotel();
  const [query, setQuery] = React.useState("");
  const router = useRouter();
  const { data: results = [] } = useSearch(query, currentHotel?.id, open);
  const actions = mockProvider.commandActions();

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  const filteredActions = query
    ? actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()))
    : actions;

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search or run a command…  (try “Room 201”, “Breakfast”, “New campaign”)"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results. Try a room, a service, a guest, or an action.</CommandEmpty>

        {results.length > 0 && (
          <CommandGroup heading="Jump to">
            {results.map((r) => {
              const Icon = KIND_ICON[r.kind];
              return (
                <CommandItem key={r.id} value={`jump-${r.id}`} onSelect={() => go(r.href)}>
                  <Icon className="h-4 w-4 text-ink-tertiary" />
                  <span className="flex-1">
                    <span className="text-ink-primary">{r.title}</span>
                    {r.subtitle && <span className="ml-2 text-[12px] text-ink-tertiary">{r.subtitle}</span>}
                  </span>
                  <CornerDownLeft className="h-3.5 w-3.5 text-ink-tertiary opacity-0 group-data-[selected=true]:opacity-100" />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {["Create", "Act"].map((group) => {
          const items = filteredActions.filter((a) => a.group === group);
          if (!items.length) return null;
          return (
            <CommandGroup key={group} heading={group}>
              {items.map((a) => {
                const Icon = ACTION_ICON[a.icon] ?? Search;
                return (
                  <CommandItem key={a.id} value={`act-${a.id}`} onSelect={() => a.href && go(a.href)}>
                    <Icon className="h-4 w-4 text-ink-tertiary" />
                    <span className="flex-1 text-ink-primary">{a.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          );
        })}
      </CommandList>
      <div className="flex items-center justify-between border-t border-border-subtle px-3 py-2 text-[11px] text-ink-tertiary">
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd> to open
          <span className="mx-1">·</span>
          <Kbd>esc</Kbd> to close
        </span>
        <span>AI OLLY</span>
      </div>
    </CommandDialog>
  );
}
