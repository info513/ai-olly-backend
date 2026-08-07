"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { BlockBody } from "./types";
import type { ContentStatus, ContentSourceType, VerificationStatus } from "./platform-destinations";

const sb = () => getSupabaseBrowserClient();

export type { ContentStatus, ContentSourceType, VerificationStatus } from "./platform-destinations";
export { SOURCE_TYPES, VERIFICATION_STATUSES, isValidLocaleTag } from "./platform-destinations";

export type PoiCategory =
  | "landmark" | "museum" | "restaurant" | "cafe" | "bar" | "beach"
  | "shop" | "activity" | "nature" | "transport" | "nightlife" | "other";

export const POI_CATEGORIES: { value: PoiCategory; label: string }[] = [
  { value: "landmark", label: "Landmark" }, { value: "museum", label: "Museum" },
  { value: "restaurant", label: "Restaurant" }, { value: "cafe", label: "Café" },
  { value: "bar", label: "Bar" }, { value: "beach", label: "Beach" },
  { value: "shop", label: "Shop" }, { value: "activity", label: "Activity" },
  { value: "nature", label: "Nature" }, { value: "transport", label: "Transport" },
  { value: "nightlife", label: "Nightlife" }, { value: "other", label: "Other" },
];

export interface Poi {
  id: string;
  destination_id: string;
  key: string;
  name: string;
  category: PoiCategory;
  short_description: string | null;
  body_content: BlockBody | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  map_url: string | null;
  website: string | null;
  phone: string | null;
  opening_info: string | null;
  accessibility_info: string | null;
  price_info: string | null;
  recommended_duration_minutes: number | null;
  valid_from: string | null;
  valid_to: string | null;
  source_type: ContentSourceType;
  source_name: string | null;
  source_url: string | null;
  imported_at: string | null;
  last_verified_at: string | null;
  verification_status: VerificationStatus;
  rights_notes: string | null;
  featured_default: boolean;
  canonical_asset_id: string | null;
  status: ContentStatus;
  active: boolean;
  sort_order: number;
  published_at: string | null;
  published_snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface PoiVersion {
  id: string;
  version_number: number;
  status: ContentStatus;
  change_summary: string | null;
  created_by: string | null;
  published_at: string | null;
  created_at: string;
  snapshot: Record<string, unknown>;
}

export interface PoiHotelUsage {
  hotelsInDestination: number;
  customized: number;      // hotels with a hotel_poi_settings row
  hiddenBy: number;
  featuredBy: number;
  recommendations: number;
  imageOverrides: number;
}

export interface PublicAsset {
  id: string;
  label: string;
  asset_type: string;
  preview_url: string | null;
  owner_scope: string;
}

const KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const isValidPoiKey = (k: string) => KEY_RE.test(k);

export const pqk = {
  list: (destId?: string, filters?: unknown) => ["platform", "pois", destId, filters] as const,
  one: (id?: string) => ["platform", "poi", id] as const,
  versions: (id?: string) => ["platform", "poiVersions", id] as const,
  usage: (id?: string) => ["platform", "poiUsage", id] as const,
  assets: (destId?: string) => ["platform", "poiAssets", destId] as const,
};

/** True when the working draft differs from the last published (live) snapshot. */
export function hasUnpublishedPoiChanges(p: Poi): boolean {
  const s = p.published_snapshot as any;
  if (!s) return false;
  const pick = (o: any) => JSON.stringify({
    key: o.key ?? null, name: o.name ?? null, category: o.category ?? null,
    short_description: o.short_description ?? null, body_content: o.body_content ?? null,
    address: o.address ?? null, latitude: o.latitude ?? null, longitude: o.longitude ?? null,
    map_url: o.map_url ?? null, website: o.website ?? null, phone: o.phone ?? null,
    opening_info: o.opening_info ?? null, accessibility_info: o.accessibility_info ?? null, price_info: o.price_info ?? null,
    recommended_duration_minutes: o.recommended_duration_minutes ?? null,
    valid_from: o.valid_from ?? null, valid_to: o.valid_to ?? null,
    source_type: o.source_type ?? null, source_name: o.source_name ?? null, source_url: o.source_url ?? null,
    last_verified_at: o.last_verified_at ?? null, verification_status: o.verification_status ?? null,
    rights_notes: o.rights_notes ?? null, featured_default: !!o.featured_default,
    canonical_asset_id: o.canonical_asset_id ?? null, active: o.active ?? true,
  });
  return pick(p) !== pick(s);
}

export interface PoiFilters {
  search?: string;
  status?: ContentStatus | "all";
  category?: PoiCategory | "all";
  verification?: VerificationStatus | "all";
  includeArchived?: boolean;
}

// ── List (destination-scoped) ───────────────────────────────────────────────
export function usePois(destinationId?: string, filters: PoiFilters = {}) {
  return useQuery({
    queryKey: pqk.list(destinationId, filters),
    enabled: !!destinationId,
    queryFn: async (): Promise<Poi[]> => {
      let q = sb().from("destination_pois").select("*").eq("destination_id", destinationId)
        .order("sort_order", { ascending: true }).order("name", { ascending: true }).limit(1000);
      if (!filters.includeArchived && (!filters.status || filters.status === "all")) q = q.neq("status", "archived");
      if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
      if (filters.category && filters.category !== "all") q = q.eq("category", filters.category);
      if (filters.verification && filters.verification !== "all") q = q.eq("verification_status", filters.verification);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as Poi[];
      const term = filters.search?.trim().toLowerCase();
      if (term) rows = rows.filter((p) =>
        [p.name, p.key, p.short_description, p.address].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)));
      return rows;
    },
  });
}

export function usePoi(id?: string) {
  return useQuery({
    queryKey: pqk.one(id),
    enabled: !!id,
    queryFn: async (): Promise<Poi> => {
      const { data, error } = await sb().from("destination_pois").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Poi;
    },
  });
}

export function usePoiHotelUsage(poiId?: string, destinationId?: string) {
  return useQuery({
    queryKey: pqk.usage(poiId),
    enabled: !!poiId,
    queryFn: async (): Promise<PoiHotelUsage> => {
      const client = sb();
      const [settings, hotels] = await Promise.all([
        client.from("hotel_poi_settings").select("hotel_id,visible,featured,hotel_recommendation,hotel_photo_url").eq("poi_id", poiId),
        destinationId
          ? client.from("hotels").select("id", { count: "exact", head: true }).eq("destination_id", destinationId)
          : Promise.resolve({ count: 0 } as any),
      ]);
      const rows = (settings.data ?? []) as any[];
      const nonEmpty = (v: any) => typeof v === "string" && v.trim().length > 0;
      return {
        hotelsInDestination: (hotels as any).count ?? 0,
        customized: rows.length,
        hiddenBy: rows.filter((r) => r.visible === false).length,
        featuredBy: rows.filter((r) => r.featured === true).length,
        recommendations: rows.filter((r) => nonEmpty(r.hotel_recommendation)).length,
        imageOverrides: rows.filter((r) => nonEmpty(r.hotel_photo_url)).length,
      };
    },
  });
}

/** Public platform/destination-owned assets selectable as canonical POI media. */
export function usePublicAssets(destinationId?: string) {
  return useQuery({
    queryKey: pqk.assets(destinationId),
    enabled: !!destinationId,
    queryFn: async (): Promise<PublicAsset[]> => {
      const { data, error } = await sb().from("assets")
        .select("id,display_name,original_filename,asset_type,owner_scope,external_url,public_access,status,deleted_at,destination_id")
        .eq("public_access", true).in("owner_scope", ["platform", "destination"])
        .is("deleted_at", null).order("updated_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? [])
        .filter((a: any) => a.status !== "archived" && (a.destination_id === null || a.destination_id === destinationId))
        .map((a: any) => ({
          id: a.id, label: a.display_name || a.original_filename || "Untitled asset",
          asset_type: a.asset_type, preview_url: a.external_url ?? null, owner_scope: a.owner_scope,
        }));
    },
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────
type PoiInput = Partial<Omit<Poi, "id" | "created_at" | "updated_at" | "published_snapshot" | "status">>;

const invalidate = (qc: ReturnType<typeof useQueryClient>, destId?: string, id?: string) => {
  qc.invalidateQueries({ queryKey: ["platform", "pois"] });
  if (id) { qc.invalidateQueries({ queryKey: pqk.one(id) }); qc.invalidateQueries({ queryKey: pqk.versions(id) }); }
};

export function useCreatePoi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: PoiInput & { destination_id: string; key: string; name: string }): Promise<string> => {
      const { data, error } = await sb().from("destination_pois").insert({ ...values, status: "draft" }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (_id, v) => invalidate(qc, (v as any).destination_id),
  });
}

export function useUpdatePoi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: PoiInput }) => {
      const { error } = await sb().from("destination_pois").update(patch).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => invalidate(qc, undefined, id),
  });
}

export function usePublishPoi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changeSummary }: { id: string; changeSummary?: string }) => {
      const { data, error } = await sb().rpc("publish_poi", { p_poi: id, p_change_summary: changeSummary ?? null });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => invalidate(qc, undefined, v.id),
  });
}

export function useRollbackPoi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, versionId }: { id: string; versionId: string }) => {
      const { data, error } = await sb().rpc("rollback_poi", { p_poi: id, p_version: versionId });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => invalidate(qc, undefined, v.id),
  });
}

export function usePoiVersions(id?: string) {
  return useQuery({
    queryKey: pqk.versions(id),
    enabled: !!id,
    queryFn: async (): Promise<PoiVersion[]> => {
      const { data, error } = await sb().rpc("list_poi_versions", { p_poi: id });
      if (error) throw error;
      return (data ?? []) as PoiVersion[];
    },
  });
}

export function useSetPoiArchived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await sb().from("destination_pois").update({ status: archived ? "archived" : "draft" }).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => invalidate(qc, undefined, id),
  });
}
