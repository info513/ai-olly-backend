"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { moduleKeyFromPath } from "@/lib/permissions";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { TopBar } from "@/components/shell/top-bar";
import { CommandPalette } from "@/components/shell/command-palette";

function ShellLoader({ label }: { label: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-surface-base">
      <div className="flex flex-col items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-cream font-display text-lg font-semibold text-brand-navyDeep">
          O
        </span>
        <span className="text-[13px] text-ink-tertiary">{label}</span>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const { loading: hotelLoading, hotels, isPlatformAdmin } = useHotel();
  const { can } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();

  const resolving = authLoading || (session && hotelLoading);
  const moduleKey = moduleKeyFromPath(pathname);
  const noTenant = Boolean(session) && !hotelLoading && !isPlatformAdmin && hotels.length === 0;
  // Platform-admin-only DEV routes (e.g. /platform/migration) bypass hotel-role modules.
  const isPlatformRoute = pathname.startsWith("/platform");
  const forbidden = Boolean(session) && !hotelLoading && !noTenant &&
    (isPlatformRoute ? !isPlatformAdmin : !can(moduleKey));

  React.useEffect(() => {
    if (resolving) return;
    if (!session) router.replace("/login");
    else if (noTenant) router.replace("/no-access");
    else if (forbidden) router.replace("/403");
  }, [resolving, session, noTenant, forbidden, router]);

  if (resolving) return <ShellLoader label="Loading your hotel…" />;
  if (!session || noTenant || forbidden) return <ShellLoader label="Redirecting…" />;

  return (
    <div className="flex h-screen overflow-hidden bg-surface-base">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      <CommandPalette />
    </div>
  );
}
