"use client";

import { Search, Menu } from "lucide-react";
import { useCommand } from "@/providers/command-provider";
import { useHotel } from "@/providers/hotel-provider";
import { Notifications } from "./notifications";
import { EnvBadge } from "./env-badge";
import { Kbd } from "@/components/ui/kbd";

export function TopBar({ title, onMenu }: { title?: string; onMenu?: () => void }) {
  const { setOpen } = useCommand();
  const { currentHotel } = useHotel();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border-subtle bg-surface-base/85 px-4 backdrop-blur-md">
      {/* Mobile: open the navigation drawer (desktop keeps the persistent rail). */}
      <button
        onClick={onMenu}
        aria-label="Open navigation menu"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-overlay hover:text-ink-primary md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {title && <h1 className="hidden text-[15px] font-semibold text-ink-primary md:block">{title}</h1>}

      {/* Mobile: keep hotel context visible (the switcher lives in the drawer). */}
      {currentHotel && (
        <span className="max-w-[42%] truncate text-[13px] font-medium text-ink-primary md:hidden">{currentHotel.name}</span>
      )}

      {/* Global search → command palette. Full field on ≥sm, icon-only on phone. */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="group ml-auto flex h-9 w-9 items-center justify-center gap-2.5 rounded-lg border border-border-strong bg-surface-sunken px-0 text-left text-ink-tertiary transition-colors hover:border-brand-goldDeep/60 sm:w-full sm:max-w-md sm:justify-start sm:px-3"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="hidden flex-1 text-[13px] sm:block">Search rooms, guests, services…</span>
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        <EnvBadge />
        <Notifications />
      </div>
    </header>
  );
}
