"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeft, DatabaseZap, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { NAV_ITEMS } from "./nav-config";
import { HotelSwitcher } from "./hotel-switcher";
import { UserMenu } from "./user-menu";
import { usePermissions } from "@/providers/permission-provider";
import { useHotel } from "@/providers/hotel-provider";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "aiolly.sidebar.collapsed";

/** Permission-aware nav list — shared by the desktop rail and the mobile drawer. */
function NavLinks({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can } = usePermissions();
  const { isPlatformAdmin } = useHotel();
  const items = NAV_ITEMS.filter((item) => can(item.href.replace(/^\//, "")));

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        const link = (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
              collapsed && "justify-center px-0",
              active ? "bg-brand-navy/60 text-ink-primary" : "text-ink-secondary hover:bg-surface-overlay hover:text-ink-primary"
            )}
          >
            {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-cream" />}
            <Icon className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1">{item.label}</span>
                {!item.ready && (
                  <span className="rounded bg-surface-overlay px-1.5 py-0.5 text-[10px] font-medium text-ink-tertiary">soon</span>
                )}
              </>
            )}
          </Link>
        );
        return collapsed ? (
          <Tooltip key={item.href}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ) : (
          link
        );
      })}

      {/* Platform-admin-only DEV tools — hidden from every hotel role. */}
      {isPlatformAdmin && (() => {
        const href = "/platform/migration";
        const active = pathname.startsWith(href);
        const link = (
          <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}
            className={cn("group relative mt-1 flex items-center gap-3 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
              collapsed && "justify-center px-0",
              active ? "bg-brand-navy/60 text-ink-primary" : "text-ink-secondary hover:bg-surface-overlay hover:text-ink-primary")}>
            {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-cream" />}
            <DatabaseZap className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && (<><span className="flex-1">Migration</span>
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">dev</span></>)}
          </Link>
        );
        return collapsed ? (
          <Tooltip><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="right">Migration (dev)</TooltipContent></Tooltip>
        ) : link;
      })()}
    </nav>
  );
}

/**
 * App navigation. Desktop (md+) = the persistent collapsible rail, unchanged.
 * Below md = an off-canvas drawer (Radix Dialog → focus trap + scrim + Escape),
 * opened by the top-bar hamburger. `mobileOpen`/`onMobileOpenChange` are driven by
 * the app layout so the same nav content serves both forms (RC1 Cluster 4 · H1).
 */
export function AppSidebar({ mobileOpen = false, onMobileOpenChange }: {
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };
  const closeMobile = () => onMobileOpenChange?.(false);

  return (
    <>
      {/* Desktop rail — hidden below md; desktop layout is pixel-identical. */}
      <aside
        className={cn(
          "hidden h-screen flex-col border-r border-border-subtle bg-surface-base transition-[width] duration-200 md:flex",
          collapsed ? "w-[68px]" : "w-[248px]"
        )}
      >
        <div className={cn("flex h-14 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
          {!collapsed && (
            <Link href="/home" className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-cream font-display text-sm font-semibold text-brand-navyDeep">O</span>
              <span className="font-display text-[15px] tracking-tight text-ink-primary">AI OLLY</span>
            </Link>
          )}
          <button
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn("ml-auto flex h-8 w-8 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-overlay hover:text-ink-primary", collapsed && "ml-0")}
          >
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
        <div className="px-3 pb-2"><HotelSwitcher collapsed={collapsed} /></div>
        <NavLinks collapsed={collapsed} />
        <div className="border-t border-border-subtle p-2"><UserMenu collapsed={collapsed} /></div>
      </aside>

      {/* Mobile drawer — same nav, expanded; closes on navigate / scrim / Escape. */}
      <Dialog.Root open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 md:hidden" />
          <Dialog.Content
            aria-label="Navigation"
            className="fixed inset-y-0 left-0 z-50 flex w-[248px] max-w-[82vw] flex-col border-r border-border-subtle bg-surface-base shadow-e3 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left md:hidden"
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <div className="flex h-14 items-center gap-2 px-3">
              <Link href="/home" onClick={closeMobile} className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-cream font-display text-sm font-semibold text-brand-navyDeep">O</span>
                <span className="font-display text-[15px] tracking-tight text-ink-primary">AI OLLY</span>
              </Link>
              <Dialog.Close aria-label="Close menu" className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-overlay hover:text-ink-primary">
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
            <div className="px-3 pb-2"><HotelSwitcher collapsed={false} /></div>
            <NavLinks collapsed={false} onNavigate={closeMobile} />
            <div className="border-t border-border-subtle p-2"><UserMenu collapsed={false} /></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
