"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useCommand } from "@/providers/command-provider";
import { PlatformProvider } from "@/providers/platform-provider";
import { PlatformSidebar } from "@/components/shell/platform/platform-sidebar";
import { PlatformContextBanner } from "@/components/shell/platform/platform-context-banner";
import { CommandPalette } from "@/components/shell/command-palette";
import { EnvBadge } from "@/components/shell/env-badge";
import { Kbd } from "@/components/ui/kbd";

/**
 * Platform CMS workspace shell (Phase 1). Distinct from the hotel workspace, gated to
 * platform_admin (the parent (app)/layout already redirects non-admins to /403; this is a
 * second-layer guard). Provides the platform sidebar + destination context + command palette.
 */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { isPlatformAdmin } = useHotel();
  const { setOpen } = useCommand();
  const [navOpen, setNavOpen] = React.useState(false);
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => { setNavOpen(false); }, [pathname]);
  React.useEffect(() => {
    if (isPlatformAdmin === false) router.replace("/403");
  }, [isPlatformAdmin, router]);

  if (!isPlatformAdmin) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface-base">
        <span className="text-[13px] text-ink-tertiary">Platform admins only…</span>
      </div>
    );
  }

  return (
    <PlatformProvider>
      <div className="flex h-screen overflow-hidden bg-surface-base">
        <PlatformSidebar mobileOpen={navOpen} onMobileOpenChange={setNavOpen} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border-subtle bg-surface-base/85 px-4 backdrop-blur-md">
            <button
              onClick={() => setNavOpen(true)}
              aria-label="Open platform navigation"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-overlay hover:text-ink-primary md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1 overflow-x-auto"><PlatformContextBanner /></div>
            <button
              onClick={() => setOpen(true)}
              aria-label="Search"
              className="group flex h-9 w-9 shrink-0 items-center justify-center gap-2.5 rounded-lg border border-border-strong bg-surface-sunken px-0 text-left text-ink-tertiary transition-colors hover:border-brand-goldDeep/60 sm:w-auto sm:justify-start sm:px-3"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="hidden items-center gap-1 sm:flex"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
            </button>
            <EnvBadge />
          </header>
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
        <CommandPalette />
      </div>
    </PlatformProvider>
  );
}
