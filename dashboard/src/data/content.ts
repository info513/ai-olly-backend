"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { qk } from "./keys";
import type { ContentSummary } from "./types";

const sb = () => getSupabaseBrowserClient();

/**
 * Content landing summary — real counts for the active hotel, computed with a
 * few small RLS-scoped reads (no service role). Cheap enough for a landing page.
 */
async function fetchContentSummary(hotelId: string): Promise<ContentSummary> {
  const client = sb();
  const nowIso = new Date().toISOString();

  const [rt, rooms, services, drafts, critical, recent] = await Promise.all([
    client.from("room_types").select("id", { count: "exact", head: true }).eq("hotel_id", hotelId),
    client.from("rooms").select("id", { count: "exact", head: true }).eq("hotel_id", hotelId),
    client.from("hotel_services").select("id", { count: "exact", head: true }).eq("hotel_id", hotelId),
    client.from("hotel_services").select("id", { count: "exact", head: true }).eq("hotel_id", hotelId).eq("status", "draft"),
    // critical content needing attention: critical + (not published OR expired)
    client
      .from("hotel_services")
      .select("id", { count: "exact", head: true })
      .eq("hotel_id", hotelId)
      .eq("is_critical", true)
      .or(`status.neq.published,valid_to.lt.${nowIso}`),
    client
      .from("hotel_services")
      .select("id, title, published_at")
      .eq("hotel_id", hotelId)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(5),
  ]);

  for (const r of [rt, rooms, services, drafts, critical, recent]) {
    if ((r as any).error) throw (r as any).error;
  }

  return {
    roomTypeCount: rt.count ?? 0,
    roomCount: rooms.count ?? 0,
    serviceCount: services.count ?? 0,
    draftsWaiting: drafts.count ?? 0,
    criticalNeedsAttention: critical.count ?? 0,
    recentlyPublished: (recent.data ?? []) as ContentSummary["recentlyPublished"],
  };
}

export function useContentSummary(hotelId?: string) {
  return useQuery({ queryKey: qk.contentSummary(hotelId), queryFn: () => fetchContentSummary(hotelId!), enabled: !!hotelId });
}
