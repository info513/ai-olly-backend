"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const sb = () => getSupabaseBrowserClient();

export interface PlatformDestination {
  id: string;
  slug: string;
  name: string;
  countryCode: string | null;
  timezone: string | null;
  status: string | null;
}

/** All destinations the caller may see (RLS: platform_admin sees all). Read-only shell. */
export function usePlatformDestinations() {
  return useQuery({
    queryKey: ["platform", "destinations"],
    queryFn: async (): Promise<PlatformDestination[]> => {
      const { data, error } = await sb()
        .from("destinations")
        .select("id,slug,name,country_code,timezone,status")
        .order("name", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []).map((d: any) => ({
        id: d.id, slug: d.slug, name: d.name, countryCode: d.country_code, timezone: d.timezone, status: d.status,
      }));
    },
  });
}

export interface PlatformStats {
  destinations: number;
  pois: number;
  routes: number;
  whispers: number;
  events: number;
  translations: number;
  hotels: number;
}

/** Read-only counts for the Platform Home cards, scoped to the current destination where relevant. */
export function usePlatformStats(destinationId?: string | null) {
  return useQuery({
    queryKey: ["platform", "stats", destinationId ?? "none"],
    queryFn: async (): Promise<PlatformStats> => {
      const countAll = (t: string) => sb().from(t).select("id", { count: "exact", head: true });
      const countDest = (t: string) =>
        destinationId ? sb().from(t).select("id", { count: "exact", head: true }).eq("destination_id", destinationId) : null;

      const [dest, pois, routes, whispers, events, tr, hotels] = await Promise.all([
        countAll("destinations"),
        countDest("destination_pois"),
        countDest("destination_routes"),
        countDest("destination_whispers"),
        countDest("destination_events"),
        countAll("translations"),
        destinationId ? sb().from("hotels").select("id", { count: "exact", head: true }).eq("destination_id", destinationId) : null,
      ]);
      const n = (r: any) => (r && !r.error ? r.count ?? 0 : 0);
      return {
        destinations: n(dest), pois: n(pois), routes: n(routes), whispers: n(whispers),
        events: n(events), translations: n(tr), hotels: n(hotels),
      };
    },
  });
}
