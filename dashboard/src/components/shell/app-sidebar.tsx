"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeft, DatabaseZap, X, ArrowRight } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { NAV_GROUPS } from "./nav-config";
import { HotelSwitcher } from "./hotel-switcher";
import { UserMenu } from "./user-menu";
import { usePermissions } from "@/providers/permission-provider";
import { useHotel } from "@/providers/hotel-provider";
import { moduleKeyFromPath } from "@/lib/permissions";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "aiolly.sidebar.collapsed";

/** Permission-aware grouped nav — shared by the desktop rail and the mobile drawer.
 *  Each job (group) appears when the role can reach its landing or any child; the
 *  active group reveals its accessible children (accordion). */
function NavLinks({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can } = usePermissions();
  const { isPlatformAdmin } = useHotel();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
      {NAV_GROUPS.map((group) => {
        const rootAccessible = can(moduleKeyFromPath(group.href));
        const kids = (group.children ?? []).filter((c) => can(moduleKeyFromPath(c.href)));
        // Hide the whole job if the role can reach neither its landing nor any child.
        if (!rootAccessible && kids.length === 0) return null;

        // If the landing itself is off-limits (e.g. marketing → Hotel Content), point
        // the header at the first child the role can actually open.
        const target = rootAccessible ? group.href : kids[0].href;
        const active = isActive(group.href) || kids.some((c) => isActive(c.href));
        const Icon = group.icon;

        const header = (
          <Link
            href={target}
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
                <span className="flex-1">{group.label}</span>
                {!group.ready && (
                  <span className="rounded bg-surface-overlay px-1.5 py-0.5 text-[10px] font-medium text-ink-tertiary">soon</span>
                )}
              </>
            )}
          </Link>
        );

        return (
          <div key={group.href}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{header}</TooltipTrigger>
                <TooltipContent side="right">{group.label}</TooltipContent>
              </Tooltip>
            ) : (
              header
            )}
            {!collapsed && active && kids.length > 0 && (
              <div className="mb-1 ml-[26px] mt-0.5 space-y-0.5 border-l border-border-subtle pl-2">
                {kids.map((c) => {
                  const cActive = isActive(c.href);
                  return (
                    <Link
                      key={c.href}
                      href={c.href}
                      onClick={onNavigate}
                      aria-current={cActive ? "page" : undefined}
                      className={cn(
                        "block rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors",
                        cActive ? "font-medium text-ink-primary" : "text-ink-tertiary hover:bg-surface-overlay hover:text-ink-secondary"
                      )}
                    >
                      {c.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Platform-admin-only WORKSPACE SWITCH — deliberately separated from the hotel
          jobs above so the two workspaces never blur together (hidden from hotel roles). */}
      {isPlatformAdmin && (() => {
        const href = "/platform";
        const link = (
          <Link href={href} onClick={onNavigate}
            className={cn("group flex items-center gap-3 rounded-md border border-brand-cream/25 bg-brand-cream/[0.06] px-2.5 py-2 text-[13px] font-medium text-brand-cream transition-colors hover:bg-brand-cream/[0.12]",
              collapsed && "justify-center px-0")}>
            <DatabaseZap className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && (<><span className="flex-1">Switch to Platform</span><ArrowRight className="h-4 w-4 shrink-0 opacity-60" /></>)}
          </Link>
        );
        return (
          <div className="mt-2 border-t border-border-subtle pt-2">
            {!collapsed && <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary">Other workspace</div>}
            {collapsed ? <Tooltip><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="right">Switch to Platform</TooltipContent></Tooltip> : link}
          </div>
        );
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
