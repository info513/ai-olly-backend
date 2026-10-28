"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";

/**
 * Consent kiosk layout — a LOCKED, chrome-free surface meant to be handed to a
 * guest on a reception tablet. It deliberately renders NO sidebar, topbar or
 * command palette, so a guest holding the tablet cannot wander into other
 * modules (guests, pricing, settings). Access is still real staff auth: the
 * reception/hotel_admin (or platform admin) signs in first, then opens the
 * kiosk. RLS remains the security boundary — this only removes navigation.
 */
function KioskLoader({ label }: { label: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-surface-base">
      <div className="flex flex-col items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-cream font-display text-lg font-semibold text-brand-navyDeep">O</span>
        <span className="text-[13px] text-ink-tertiary">{label}</span>
      </div>
    </div>
  );
}

export default function ConsentKioskLayout({ children }: { children: React.ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const { loading: hotelLoading, hotels, isPlatformAdmin, profile } = useHotel();
  const { can } = usePermissions();
  const router = useRouter();

  const resolving = authLoading || (session && hotelLoading);
  const suspended = Boolean(session) && !hotelLoading && profile != null && profile.active === false;
  const noTenant = suspended || (Boolean(session) && !hotelLoading && !isPlatformAdmin && hotels.length === 0);
  // Consent is a reception/hotel_admin module; platform admins pass via can().
  const forbidden = Boolean(session) && !hotelLoading && !noTenant && !can("consent");

  React.useEffect(() => {
    if (resolving) return;
    if (!session) router.replace("/login");
    else if (noTenant) router.replace("/no-access");
    else if (forbidden) router.replace("/403");
  }, [resolving, session, noTenant, forbidden, router]);

  if (resolving) return <KioskLoader label="Loading…" />;
  if (!session || noTenant || forbidden) return <KioskLoader label="Redirecting…" />;

  return <div className="min-h-screen bg-surface-base">{children}</div>;
}
