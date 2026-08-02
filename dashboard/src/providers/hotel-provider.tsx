"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAuth } from "./auth-provider";
import type { HotelMembershipItem, Profile } from "@/lib/types";
import type { Role } from "@/lib/permissions";

/**
 * HotelContextProvider — the real multi-tenant context. After sign-in it loads
 * the user's profile and their ACTIVE memberships (RLS-scoped: the user only
 * ever sees their own). The active hotel is remembered in localStorage; the
 * current role is the role at the active hotel. Switching hotels changes context
 * in place — no full reload.
 */
interface HotelContextValue {
  profile: Profile | null;
  hotels: HotelMembershipItem[];
  currentHotel: HotelMembershipItem | null;
  role: Role | null;
  isPlatformAdmin: boolean;
  setHotelId: (id: string) => void;
  loading: boolean;
}

const HotelContext = React.createContext<HotelContextValue | null>(null);
const STORAGE_KEY = "aiolly.hotel";

async function loadContext(userId: string): Promise<{ profile: Profile | null; hotels: HotelMembershipItem[] }> {
  const supabase = getSupabaseBrowserClient();

  const [{ data: prof }, { data: memberships, error }] = await Promise.all([
    supabase.from("profiles").select("user_id,email,display_name,is_platform_admin").eq("user_id", userId).maybeSingle(),
    supabase
      .from("hotel_memberships")
      .select("role, hotel:hotels(id,name,slug, destination:destinations(name))")
      .eq("status", "active"),
  ]);
  if (error) throw error;

  const hotels: HotelMembershipItem[] = (memberships ?? [])
    .filter((m: any) => m.hotel)
    .map((m: any) => ({
      id: m.hotel.id,
      name: m.hotel.name,
      slug: m.hotel.slug,
      destination: m.hotel.destination?.name ?? "—",
      role: m.role as Role,
    }))
    .sort((a: HotelMembershipItem, b: HotelMembershipItem) => a.name.localeCompare(b.name));

  const profile: Profile | null = prof
    ? { userId: prof.user_id, email: prof.email, displayName: prof.display_name, isPlatformAdmin: !!prof.is_platform_admin }
    : null;

  return { profile, hotels };
}

export function HotelProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [hotelId, setHotelIdState] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["hotel-context", user?.id],
    queryFn: () => loadContext(user!.id),
    enabled: Boolean(user?.id),
  });

  React.useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (stored) setHotelIdState(stored);
  }, []);

  const hotels = data?.hotels ?? [];

  // reconcile active hotel with real memberships (unknown/stale id -> first)
  React.useEffect(() => {
    if (!hotels.length) return;
    if (!hotelId || !hotels.some((h) => h.id === hotelId)) {
      setHotelIdState(hotels[0].id);
      window.localStorage.setItem(STORAGE_KEY, hotels[0].id);
    }
  }, [hotels, hotelId]);

  const setHotelId = React.useCallback((id: string) => {
    window.localStorage.setItem(STORAGE_KEY, id);
    setHotelIdState(id);
  }, []);

  const currentHotel = hotels.find((h) => h.id === hotelId) ?? hotels[0] ?? null;

  const value: HotelContextValue = {
    profile: data?.profile ?? null,
    hotels,
    currentHotel,
    role: currentHotel?.role ?? null,
    isPlatformAdmin: data?.profile?.isPlatformAdmin ?? false,
    setHotelId,
    loading: authLoading || (Boolean(user) && isLoading),
  };

  return <HotelContext.Provider value={value}>{children}</HotelContext.Provider>;
}

export function useHotel() {
  const ctx = React.useContext(HotelContext);
  if (!ctx) throw new Error("useHotel must be used within <HotelProvider>");
  return ctx;
}
