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

export interface Whisper {
  id: string; destination_id: string; channel_key: string; key: string; title: string;
  short_description: string | null; body_content: BlockBody | null;
  source_type: ContentSourceType; source_name: string | null; source_url: string | null;
  imported_at: string | null; last_verified_at: string | null; verification_status: VerificationStatus;
  rights_notes: string | null; featured_default: boolean; canonical_asset_id: string | null;
  status: ContentStatus; active: boolean; sort_order: number; published_at: string | null;
  published_snapshot: Record<string, unknown> | null; created_at: string; updated_at: string;
}
export interface WhisperVersion { id: string; version_number: number; status: ContentStatus; change_summary: string | null; created_by: string | null; published_at: string | null; created_at: string; snapshot: Record<string, unknown>; }
export interface WhisperHotelUsage { hotelsInDestination: number; customized: number; hiddenBy: number; featuredBy: number; recommendations: number; }

const KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const isValidWhisperKey = (k: string) => KEY_RE.test(k);

export const wqk = {
  list: (d?: string, f?: unknown) => ["platform", "whispers", d, f] as const,
  one: (id?: string) => ["platform", "whisper", id] as const,
  versions: (id?: string) => ["platform", "whisperVersions", id] as const,
  usage: (id?: string) => ["platform", "whisperUsage", id] as const,
};

export function hasUnpublishedWhisperChanges(w: Whisper): boolean {
  const s = w.published_snapshot as any; if (!s) return false;
  const pick = (o: any) => JSON.stringify({ channel_key: o.channel_key ?? null, key: o.key ?? null, title: o.title ?? null, short_description: o.short_description ?? null, body_content: o.body_content ?? null, source_type: o.source_type ?? null, source_name: o.source_name ?? null, source_url: o.source_url ?? null, last_verified_at: o.last_verified_at ?? null, verification_status: o.verification_status ?? null, rights_notes: o.rights_notes ?? null, featured_default: !!o.featured_default, canonical_asset_id: o.canonical_asset_id ?? null, active: o.active ?? true });
  return pick(w) !== pick(s);
}

export interface WhisperFilters { search?: string; status?: ContentStatus | "all"; channel?: string | "all"; verification?: VerificationStatus | "all"; includeArchived?: boolean; }

export function useWhispers(destinationId?: string, filters: WhisperFilters = {}) {
  return useQuery({
    queryKey: wqk.list(destinationId, filters), enabled: !!destinationId,
    queryFn: async (): Promise<Whisper[]> => {
      let q = sb().from("destination_whispers").select("*").eq("destination_id", destinationId).order("channel_key").order("sort_order").order("title").limit(1000);
      if (!filters.includeArchived && (!filters.status || filters.status === "all")) q = q.neq("status", "archived");
      if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
      if (filters.channel && filters.channel !== "all") q = q.eq("channel_key", filters.channel);
      if (filters.verification && filters.verification !== "all") q = q.eq("verification_status", filters.verification);
      const { data, error } = await q; if (error) throw error;
      let rows = (data ?? []) as Whisper[];
      const term = filters.search?.trim().toLowerCase();
      if (term) rows = rows.filter((w) => [w.title, w.key, w.channel_key, w.short_description].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)));
      return rows;
    },
  });
}
export function useWhisper(id?: string) {
  return useQuery({ queryKey: wqk.one(id), enabled: !!id, queryFn: async (): Promise<Whisper> => { const { data, error } = await sb().from("destination_whispers").select("*").eq("id", id).single(); if (error) throw error; return data as Whisper; } });
}
export function useWhisperHotelUsage(whisperId?: string, destinationId?: string) {
  return useQuery({
    queryKey: wqk.usage(whisperId), enabled: !!whisperId,
    queryFn: async (): Promise<WhisperHotelUsage> => {
      const client = sb();
      const [settings, hotels] = await Promise.all([
        client.from("hotel_whisper_settings").select("hotel_id,visible,featured,hotel_recommendation").eq("whisper_id", whisperId),
        destinationId ? client.from("hotels").select("id", { count: "exact", head: true }).eq("destination_id", destinationId) : Promise.resolve({ count: 0 } as any),
      ]);
      const rows = (settings.data ?? []) as any[]; const ne = (v: any) => typeof v === "string" && v.trim().length > 0;
      return { hotelsInDestination: (hotels as any).count ?? 0, customized: rows.length, hiddenBy: rows.filter((r) => r.visible === false).length, featuredBy: rows.filter((r) => r.featured === true).length, recommendations: rows.filter((r) => ne(r.hotel_recommendation)).length };
    },
  });
}

type WhisperInput = Partial<Omit<Whisper, "id" | "created_at" | "updated_at" | "published_snapshot" | "status">>;
const inv = (qc: ReturnType<typeof useQueryClient>, id?: string) => { qc.invalidateQueries({ queryKey: ["platform", "whispers"] }); if (id) { qc.invalidateQueries({ queryKey: wqk.one(id) }); qc.invalidateQueries({ queryKey: wqk.versions(id) }); } };

export function useCreateWhisper() { const qc = useQueryClient(); return useMutation({ mutationFn: async (v: WhisperInput & { destination_id: string; channel_key: string; key: string; title: string }): Promise<string> => { const { data, error } = await sb().from("destination_whispers").insert({ ...v, status: "draft" }).select("id").single(); if (error) throw error; return data.id as string; }, onSuccess: () => inv(qc) }); }
export function useUpdateWhisper() { const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, patch }: { id: string; patch: WhisperInput }) => { const { error } = await sb().from("destination_whispers").update(patch).eq("id", id); if (error) throw error; return id; }, onSuccess: (id) => inv(qc, id) }); }
export function usePublishWhisper() { const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, changeSummary }: { id: string; changeSummary?: string }) => { const { data, error } = await sb().rpc("publish_whisper", { p_whisper: id, p_change_summary: changeSummary ?? null }); if (error) throw error; return data; }, onSuccess: (_d, v) => inv(qc, v.id) }); }
export function useRollbackWhisper() { const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, versionId }: { id: string; versionId: string }) => { const { data, error } = await sb().rpc("rollback_whisper", { p_whisper: id, p_version: versionId }); if (error) throw error; return data; }, onSuccess: (_d, v) => inv(qc, v.id) }); }
export function useWhisperVersions(id?: string) { return useQuery({ queryKey: wqk.versions(id), enabled: !!id, queryFn: async (): Promise<WhisperVersion[]> => { const { data, error } = await sb().rpc("list_whisper_versions", { p_whisper: id }); if (error) throw error; return (data ?? []) as WhisperVersion[]; } }); }
export function useSetWhisperArchived() { const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => { const { error } = await sb().from("destination_whispers").update({ status: archived ? "archived" : "draft" }).eq("id", id); if (error) throw error; return id; }, onSuccess: (id) => inv(qc, id) }); }
