"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { DEvent } from "./platform-events";

const sb = () => getSupabaseBrowserClient();
export type { DEvent } from "./platform-events";
export { isEventEnded } from "./platform-events";

/** A live-feed item is a destination_event flagged is_live_feed. It reuses the
 *  whole Events publishing/draft-live/history/rollback/archive workflow. */
export const lqk = { list: (d?: string, f?: unknown) => ["platform", "livefeed", d, f] as const };

/** Normalized dedup key: lowercase title + start date (day). Prevents importing
 *  the same feed item twice into a destination. */
export function feedDedupKey(title: string, startsAt: string | null): string {
  const t = title.toLowerCase().trim().replace(/\s+/g, " ");
  const d = startsAt ? new Date(startsAt).toISOString().slice(0, 10) : "nodate";
  return `${t}|${d}`.slice(0, 200);
}

export interface FeedFilters { search?: string; state?: "all" | "current" | "expired"; includeArchived?: boolean; }

export function useFeedEvents(destinationId?: string, filters: FeedFilters = {}) {
  return useQuery({
    queryKey: lqk.list(destinationId, filters), enabled: !!destinationId,
    queryFn: async (): Promise<DEvent[]> => {
      let q = sb().from("destination_events").select("*").eq("destination_id", destinationId).eq("is_live_feed", true).order("starts_at", { ascending: true, nullsFirst: false }).limit(1000);
      if (!filters.includeArchived) q = q.neq("status", "archived");
      const { data, error } = await q; if (error) throw error;
      let rows = (data ?? []) as DEvent[];
      const now = Date.now();
      if (filters.state === "current") rows = rows.filter((e) => !e.ends_at || new Date(e.ends_at).getTime() >= now);
      if (filters.state === "expired") rows = rows.filter((e) => !!e.ends_at && new Date(e.ends_at).getTime() < now);
      const term = filters.search?.trim().toLowerCase();
      if (term) rows = rows.filter((e) => [e.title, e.key, e.location_name, e.feed_source].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)));
      return rows;
    },
  });
}

const inv = (qc: ReturnType<typeof useQueryClient>) => { qc.invalidateQueries({ queryKey: ["platform", "livefeed"] }); qc.invalidateQueries({ queryKey: ["platform", "events"] }); };

export interface FeedImportInput { destination_id: string; key: string; title: string; feed_source: string; starts_at: string | null; ends_at: string | null; all_day: boolean; location_name: string | null; short_description: string | null; }

/** Import (manual) a feed item. Dedup: the DB partial-unique index on
 *  (destination_id, feed_dedup_key) rejects a duplicate (Postgres 23505). */
export function useImportFeedEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: FeedImportInput): Promise<string> => {
      const { data, error } = await sb().from("destination_events").insert({
        ...v, is_live_feed: true, source_type: "city_event_feed", feed_dedup_key: feedDedupKey(v.title, v.starts_at),
        feed_imported_at: new Date().toISOString(), status: "draft",
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => inv(qc),
  });
}

/** Promote a feed item to a curated event (clears the feed flag + dedup key). */
export function usePromoteFeedEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await sb().from("destination_events").update({ is_live_feed: false, feed_dedup_key: null }).eq("id", id); if (error) throw error; return id; },
    onSuccess: () => inv(qc),
  });
}

/** Auto-expiry: archive published feed items whose end is in the past. */
export function useArchiveExpiredFeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (destinationId: string): Promise<number> => { const { data, error } = await sb().rpc("archive_expired_feed_events", { p_destination: destinationId }); if (error) throw error; return (data as number) ?? 0; },
    onSuccess: () => inv(qc),
  });
}
