"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { BlockBody } from "./types";
import type { ContentStatus, ContentSourceType, VerificationStatus } from "./platform-destinations";

const sb = () => getSupabaseBrowserClient();
export type { ContentStatus, ContentSourceType, VerificationStatus } from "./platform-destinations";
export { SOURCE_TYPES, VERIFICATION_STATUSES } from "./platform-destinations";
export { usePublicAssets } from "./platform-pois";
export type { PublicAsset } from "./platform-pois";

export interface DEvent {
  id: string; destination_id: string; key: string; title: string; short_description: string | null; body_content: BlockBody | null;
  starts_at: string | null; ends_at: string | null; all_day: boolean; location_name: string | null; latitude: number | null; longitude: number | null; recurrence: string | null;
  source_type: ContentSourceType; source_name: string | null; source_url: string | null; imported_at: string | null; last_verified_at: string | null; verification_status: VerificationStatus;
  rights_notes: string | null; featured_default: boolean; canonical_asset_id: string | null;
  is_live_feed: boolean; feed_source: string | null; feed_dedup_key: string | null; feed_imported_at: string | null;
  status: ContentStatus; active: boolean; sort_order: number; published_at: string | null; published_snapshot: Record<string, unknown> | null; created_at: string; updated_at: string;
}
export interface EventVersion { id: string; version_number: number; status: ContentStatus; change_summary: string | null; created_by: string | null; published_at: string | null; created_at: string; snapshot: Record<string, unknown>; }
export interface EventHotelUsage { hotelsInDestination: number; customized: number; hiddenBy: number; featuredBy: number; recommendations: number; }

const KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/; export const isValidEventKey = (k: string) => KEY_RE.test(k);
export const eqk = { list: (d?: string, f?: unknown) => ["platform", "events", d, f] as const, one: (id?: string) => ["platform", "event", id] as const, versions: (id?: string) => ["platform", "eventVersions", id] as const, usage: (id?: string) => ["platform", "eventUsage", id] as const };

export function hasUnpublishedEventChanges(e: DEvent): boolean {
  const s = e.published_snapshot as any; if (!s) return false;
  const pick = (o: any) => JSON.stringify({ key: o.key ?? null, title: o.title ?? null, short_description: o.short_description ?? null, body_content: o.body_content ?? null, starts_at: o.starts_at ?? null, ends_at: o.ends_at ?? null, all_day: !!o.all_day, location_name: o.location_name ?? null, latitude: o.latitude ?? null, longitude: o.longitude ?? null, recurrence: o.recurrence ?? null, source_type: o.source_type ?? null, source_name: o.source_name ?? null, source_url: o.source_url ?? null, last_verified_at: o.last_verified_at ?? null, verification_status: o.verification_status ?? null, rights_notes: o.rights_notes ?? null, featured_default: !!o.featured_default, canonical_asset_id: o.canonical_asset_id ?? null, active: o.active ?? true });
  return pick(e) !== pick(s);
}
export const isEventEnded = (e: { ends_at: string | null }) => !!e.ends_at && new Date(e.ends_at).getTime() < Date.now();

export interface EventFilters { search?: string; status?: ContentStatus | "all"; verification?: VerificationStatus | "all"; timeframe?: "all" | "upcoming" | "past"; includeArchived?: boolean; }

export function useEvents(destinationId?: string, filters: EventFilters = {}) {
  return useQuery({
    queryKey: eqk.list(destinationId, filters), enabled: !!destinationId,
    queryFn: async (): Promise<DEvent[]> => {
      let q = sb().from("destination_events").select("*").eq("destination_id", destinationId).order("starts_at", { ascending: true, nullsFirst: false }).order("sort_order").limit(1000);
      if (!filters.includeArchived && (!filters.status || filters.status === "all")) q = q.neq("status", "archived");
      if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
      if (filters.verification && filters.verification !== "all") q = q.eq("verification_status", filters.verification);
      const { data, error } = await q; if (error) throw error;
      let rows = (data ?? []) as DEvent[];
      if (filters.timeframe === "upcoming") rows = rows.filter((e) => !e.ends_at || new Date(e.ends_at).getTime() >= Date.now());
      if (filters.timeframe === "past") rows = rows.filter((e) => !!e.ends_at && new Date(e.ends_at).getTime() < Date.now());
      const term = filters.search?.trim().toLowerCase();
      if (term) rows = rows.filter((e) => [e.title, e.key, e.short_description, e.location_name].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)));
      return rows;
    },
  });
}
export function useEvent(id?: string) { return useQuery({ queryKey: eqk.one(id), enabled: !!id, queryFn: async (): Promise<DEvent> => { const { data, error } = await sb().from("destination_events").select("*").eq("id", id).single(); if (error) throw error; return data as DEvent; } }); }
export function useEventHotelUsage(eventId?: string, destinationId?: string) {
  return useQuery({ queryKey: eqk.usage(eventId), enabled: !!eventId, queryFn: async (): Promise<EventHotelUsage> => {
    const client = sb(); const [settings, hotels] = await Promise.all([client.from("hotel_event_settings").select("hotel_id,visible,featured,hotel_recommendation").eq("event_id", eventId), destinationId ? client.from("hotels").select("id", { count: "exact", head: true }).eq("destination_id", destinationId) : Promise.resolve({ count: 0 } as any)]);
    const rows = (settings.data ?? []) as any[]; const ne = (v: any) => typeof v === "string" && v.trim().length > 0;
    return { hotelsInDestination: (hotels as any).count ?? 0, customized: rows.length, hiddenBy: rows.filter((r) => r.visible === false).length, featuredBy: rows.filter((r) => r.featured === true).length, recommendations: rows.filter((r) => ne(r.hotel_recommendation)).length };
  } });
}
type EventInput = Partial<Omit<DEvent, "id" | "created_at" | "updated_at" | "published_snapshot" | "status">>;
const inv = (qc: ReturnType<typeof useQueryClient>, id?: string) => { qc.invalidateQueries({ queryKey: ["platform", "events"] }); if (id) { qc.invalidateQueries({ queryKey: eqk.one(id) }); qc.invalidateQueries({ queryKey: eqk.versions(id) }); } };
export function useCreateEvent() { const qc = useQueryClient(); return useMutation({ mutationFn: async (v: EventInput & { destination_id: string; key: string; title: string }): Promise<string> => { const { data, error } = await sb().from("destination_events").insert({ ...v, status: "draft" }).select("id").single(); if (error) throw error; return data.id as string; }, onSuccess: () => inv(qc) }); }
export function useUpdateEvent() { const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, patch }: { id: string; patch: EventInput }) => { const { error } = await sb().from("destination_events").update(patch).eq("id", id); if (error) throw error; return id; }, onSuccess: (id) => inv(qc, id) }); }
export function usePublishEvent() { const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, changeSummary }: { id: string; changeSummary?: string }) => { const { data, error } = await sb().rpc("publish_event", { p_event: id, p_change_summary: changeSummary ?? null }); if (error) throw error; return data; }, onSuccess: (_d, v) => inv(qc, v.id) }); }
export function useRollbackEvent() { const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, versionId }: { id: string; versionId: string }) => { const { data, error } = await sb().rpc("rollback_event", { p_event: id, p_version: versionId }); if (error) throw error; return data; }, onSuccess: (_d, v) => inv(qc, v.id) }); }
export function useEventVersions(id?: string) { return useQuery({ queryKey: eqk.versions(id), enabled: !!id, queryFn: async (): Promise<EventVersion[]> => { const { data, error } = await sb().rpc("list_event_versions", { p_event: id }); if (error) throw error; return (data ?? []) as EventVersion[]; } }); }
export function useSetEventArchived() { const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => { const { error } = await sb().from("destination_events").update({ status: archived ? "archived" : "draft" }).eq("id", id); if (error) throw error; return id; }, onSuccess: (id) => inv(qc, id) }); }
