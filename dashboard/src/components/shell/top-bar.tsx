"use client";

import { Search } from "lucide-react";
import { useCommand } from "@/providers/command-provider";
import { Notifications } from "./notifications";
import { EnvBadge } from "./env-badge";
import { Kbd } from "@/components/ui/kbd";

export function TopBar({ title }: { title?: string }) {
  const { setOpen } = useCommand();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border-subtle bg-surface-base/85 px-4 backdrop-blur-md">
      {title && <h1 className="hidden text-[15px] font-semibold text-ink-primary md:block">{title}</h1>}

      {/* Global search (opens the command palette) */}
      <button
        onClick={() => setOpen(true)}
        className="group ml-auto flex h-9 w-full max-w-md items-center gap-2.5 rounded-lg border border-border-strong bg-surface-sunken px-3 text-left text-ink-tertiary transition-colors hover:border-brand-goldDeep/60"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-[13px]">Search rooms, guests, services…</span>
        <span className="flex items-center gap-1">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="flex items-center gap-1.5">
        <EnvBadge />
        <Notifications />
      </div>
    </header>
  );
}
