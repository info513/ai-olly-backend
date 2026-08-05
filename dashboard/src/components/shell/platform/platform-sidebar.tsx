"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, ArrowLeft, DatabaseZap } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { PLATFORM_NAV } from "./platform-nav-config";
import { DestinationSwitcher } from "./destination-switcher";
import { UserMenu } from "../user-menu";
import { useHotel } from "@/providers/hotel-provider";
import { cn } from "@/lib/utils";

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { isPlatformAdmin } = useHotel();
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
      {PLATFORM_NAV.map((item) => {
        // exact match for the /platform dashboard, prefix for the rest
        const active = item.href === "/platform" ? pathname === "/platform" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
              active ? "bg-brand-navy/60 text-ink-primary" : "text-ink-secondary hover:bg-surface-overlay hover:text-ink-primary"
            )}
          >
            {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-cream" />}
            <Icon className="h-[18px] w-[18px] shrink-0" />
            <span className="flex-1">{item.label}</span>
            {!item.ready && <span className="rounded bg-surface-overlay px-1.5 py-0.5 text-[10px] font-medium text-ink-tertiary">soon</span>}
          </Link>
        );
      })}
      {isPlatformAdmin && (
        <Link href="/platform/migration" onClick={onNavigate}
          className={cn("group relative mt-1 flex items-center gap-3 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
            pathname.startsWith("/platform/migration") ? "bg-brand-navy/60 text-ink-primary" : "text-ink-secondary hover:bg-surface-overlay hover:text-ink-primary")}>
          <DatabaseZap className="h-[18px] w-[18px] shrink-0" />
          <span className="flex-1">Migration</span>
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">dev</span>
        </Link>
      )}
    </nav>
  );
}

function Body({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="px-3 pb-2 pt-1"><DestinationSwitcher /></div>
      <NavLinks onNavigate={onNavigate} />
      <div className="border-t border-border-subtle p-2">
        <Link href="/home" onClick={onNavigate} className="mb-1 flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-surface-overlay hover:text-ink-primary">
          <ArrowLeft className="h-[18px] w-[18px] shrink-0" /> Exit to hotel workspace
        </Link>
        <UserMenu collapsed={false} />
      </div>
    </>
  );
}

/** Platform CMS sidebar. Persistent rail ≥md; off-canvas drawer below md (same nav). */
export function PlatformSidebar({ mobileOpen = false, onMobileOpenChange }: {
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}) {
  const closeMobile = () => onMobileOpenChange?.(false);
  return (
    <>
      <aside className="hidden h-screen w-[248px] flex-col border-r border-border-subtle bg-surface-base md:flex">
        <div className="flex h-14 items-center gap-2 px-3">
          <Link href="/platform" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-cream font-display text-sm font-semibold text-brand-navyDeep">O</span>
            <span className="font-display text-[15px] tracking-tight text-ink-primary">Platform</span>
            <span className="rounded bg-brand-cream/15 px-1.5 py-0.5 text-[10px] font-medium text-brand-cream">CMS</span>
          </Link>
        </div>
        <Body />
      </aside>

      <Dialog.Root open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 md:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[248px] max-w-[82vw] flex-col border-r border-border-subtle bg-surface-base shadow-e3 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left md:hidden">
            <Dialog.Title className="sr-only">Platform navigation</Dialog.Title>
            <div className="flex h-14 items-center gap-2 px-3">
              <Link href="/platform" onClick={closeMobile} className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-cream font-display text-sm font-semibold text-brand-navyDeep">O</span>
                <span className="font-display text-[15px] tracking-tight text-ink-primary">Platform</span>
                <span className="rounded bg-brand-cream/15 px-1.5 py-0.5 text-[10px] font-medium text-brand-cream">CMS</span>
              </Link>
              <Dialog.Close aria-label="Close menu" className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-overlay hover:text-ink-primary">
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
            <Body onNavigate={closeMobile} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
