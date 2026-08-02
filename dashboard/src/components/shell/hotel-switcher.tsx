"use client";

import { Check, ChevronsUpDown, Building2 } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<string, string> = {
  platform_admin: "Platform admin",
  hotel_admin: "Hotel admin",
  reception: "Reception",
  editor: "Editor",
  marketing: "Marketing",
  read_only: "Read only",
};

export function HotelSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { hotels, currentHotel, setHotelId } = useHotel();
  if (!currentHotel) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg border border-border-subtle bg-surface-raised px-2.5 py-2 text-left transition-colors hover:bg-surface-overlay",
          collapsed && "justify-center px-0"
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-navy text-brand-cream">
          <Building2 className="h-4 w-4" />
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink-primary">
                {currentHotel.name}
              </span>
              <span className="block truncate text-[11px] text-ink-tertiary">
                {ROLE_LABEL[currentHotel.role]} · {currentHotel.destination}
              </span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-ink-tertiary" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Switch hotel</DropdownMenuLabel>
        {hotels.map((h) => (
          <DropdownMenuItem key={h.id} onSelect={() => setHotelId(h.id)}>
            <span className="flex h-6 w-6 items-center justify-center rounded bg-brand-navy text-brand-cream">
              <Building2 className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink-primary">{h.name}</span>
              <span className="block truncate text-[11px] text-ink-tertiary">{ROLE_LABEL[h.role]}</span>
            </span>
            {h.id === currentHotel.id && <Check className="h-4 w-4 text-brand-cream" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-ink-tertiary">Manage hotels…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
