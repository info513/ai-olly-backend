"use client";

// AI OLLY — Hotel Presentation (Phase 10). A hotel controls ONLY its own
// presentation of shared, canonical destination content (POIs, Routes, Whispers,
// Events) via the existing hotel_{poi,route,whisper,event}_settings tables
// (Pattern B RLS). Canonical facts are read-only — served by the read-only
// hotel_presentation_*(p_hotel) RPCs (published_snapshot with row fallback,
// includes hidden items). Writes touch ONLY the settings tables. No canonical edits.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const sb = () => getSupabaseBrowserClient();

export type PresEntity = "poi" | "route" | "whisper" | "event";

interface EntityCfg {
  rpc: string; table: string; idCol: string;
  supports: { walkingTime: boolean; photo: boolean; shortDescription: boolean };
}
export const PRES_ENTITIES: Record<PresEntity, EntityCfg> = {
  poi:     { rpc: "hotel_presentation_pois",     table: "hotel_poi_settings",     idCol: "poi_id",     supports: { walkingTime: true,  photo: true,  shortDescription: true } },
  route:   { rpc: "hotel_presentation_routes",   table: "hotel_route_settings",   idCol: "route_id",   supports: { walkingTime: true,  photo: true,  shortDescription: true } },
  whisper: { rpc: "hotel_presentation_whispers", table: "hotel_whisper_settings", idCol: "whisper_id", supports: { walkingTime: false, photo: false, shortDescription: false } },
  event:   { rpc: "hotel_presentation_events",   table: "hotel_event_settings",   idCol: "event_id",   supports: { walkingTime: false, photo: false, shortDescription: true } },
};

export interface CanonicalFact { label: string; value: string }
export interface PresRow {
  entityId: string;
  key: string;
  title: string;
  group: string | null;            // whisper channel; else null
  facts: CanonicalFact[];          // canonical, read-only
  visible: boolean;
  featured: boolean;
  sortOrderOverride: number | null;
  canonicalSortOrder: number | null;
  walkingTimeMinutes: number | null;
  hotelRecommendation: string | null;
  hotelPhotoUrl: string | null;
  hotelShortDescription: string | null;
  hasSettings: boolean;
  publishedAt: string | null;
}

export interface SettingsPatch {
  visible?: boolean;
  featured?: boolean;
  sort_order_override?: number | null;
  walking_time_minutes?: number | null;
  hotel_recommendation?: string | null;
  hotel_photo_url?: string | null;
  hotel_short_description?: string | null;
}

const fmtCoord = (lat: any, lng: any) => (lat != null && lng != null ? `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}` : null);
const fmtDate = (s: any) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null);
const push = (arr: CanonicalFact[], label: string, value: any) => { if (value != null && value !== "") arr.push({ label, value: String(value) }); };

function mapRow(entity: PresEntity, r: any): PresRow {
  const facts: CanonicalFact[] = [];
  let title = "", group: string | null = null;
  if (entity === "poi") {
    title = r.name;
    push(facts, "Category", r.category);
    push(facts, "About", r.short_description);
    push(facts, "Address", r.address);
    push(facts, "Coordinates", fmtCoord(r.latitude, r.longitude));
  } else if (entity === "route") {
    title = r.name;
    push(facts, "Difficulty", r.difficulty);
    push(facts, "Distance", r.distance_km != null ? `${r.distance_km} km` : null);
    push(facts, "Duration", r.duration_minutes != null ? `${r.duration_minutes} min` : null);
    push(facts, "About", r.short_description);
  } else if (entity === "whisper") {
    title = r.title; group = r.channel_key ?? null;
    push(facts, "Channel", r.channel_key);
  } else {
    title = r.title;
    push(facts, "When", r.all_day ? `${fmtDate(r.starts_at)} (all day)` : `${fmtDate(r.starts_at)}${r.ends_at ? ` → ${fmtDate(r.ends_at)}` : ""}`);
    push(facts, "Where", r.location_name);
    push(facts, "About", r.short_description);
  }
  return {
    entityId: r[PRES_ENTITIES[entity].idCol],
    key: r.key, title, group, facts,
    visible: r.visible, featured: r.featured,
    sortOrderOverride: r.sort_order_override ?? null,
    canonicalSortOrder: r.sort_order ?? null,
    walkingTimeMinutes: r.walking_time_minutes ?? null,
    hotelRecommendation: r.hotel_recommendation ?? null,
    hotelPhotoUrl: r.hotel_photo_url ?? null,
    hotelShortDescription: r.hotel_short_description ?? null,
    hasSettings: !!r.has_settings,
    publishedAt: r.published_at ?? null,
  };
}

export const hpk = {
  list: (entity: PresEntity, hotelId?: string) => ["hotel-presentation", entity, hotelId] as const,
};

export function useHotelPresentation(entity: PresEntity, hotelId?: string) {
  return useQuery({
    queryKey: hpk.list(entity, hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<PresRow[]> => {
      const { data, error } = await sb().rpc(PRES_ENTITIES[entity].rpc, { p_hotel: hotelId });
      if (error) throw error;
      return (data ?? []).map((r: any) => mapRow(entity, r));
    },
  });
}

/** Overview counts across all four entities for the Presentation home. */
export function useHotelPresentationSummary(hotelId?: string) {
  return useQuery({
    queryKey: ["hotel-presentation", "summary", hotelId] as const,
    enabled: !!hotelId,
    queryFn: async () => {
      const entities: PresEntity[] = ["poi", "route", "whisper", "event"];
      const out: Record<PresEntity, { total: number; hidden: number; featured: number; customized: number }> = {
        poi: { total: 0, hidden: 0, featured: 0, customized: 0 }, route: { total: 0, hidden: 0, featured: 0, customized: 0 },
        whisper: { total: 0, hidden: 0, featured: 0, customized: 0 }, event: { total: 0, hidden: 0, featured: 0, customized: 0 },
      };
      await Promise.all(entities.map(async (e) => {
        const { data, error } = await sb().rpc(PRES_ENTITIES[e].rpc, { p_hotel: hotelId });
        if (error) throw error;
        for (const r of data ?? []) {
          out[e].total++;
          if (!r.visible) out[e].hidden++;
          if (r.featured) out[e].featured++;
          if (r.has_settings) out[e].customized++;
        }
      }));
      return out;
    },
  });
}

/** Write ONLY the hotel's own settings row. Read-modify-write so a partial patch
 *  never clobbers other override columns. Canonical content is never touched. */
export function useUpsertPresentationSettings(entity: PresEntity, hotelId?: string) {
  const qc = useQueryClient();
  const { table, idCol } = PRES_ENTITIES[entity];
  return useMutation({
    mutationFn: async ({ entityId, patch }: { entityId: string; patch: SettingsPatch }) => {
      if (!hotelId) throw new Error("No hotel selected.");
      const { data: existing } = await sb().from(table).select("id").eq("hotel_id", hotelId).eq(idCol, entityId).maybeSingle();
      if (existing?.id) {
        const { error } = await sb().from(table).update(patch).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await sb().from(table).insert({ hotel_id: hotelId, [idCol]: entityId, ...patch });
        if (error) throw error;
      }
      return entityId;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hotel-presentation"] }); },
  });
}

/** Reset presentation to the platform default — delete the hotel's settings row. */
export function useResetPresentationSettings(entity: PresEntity, hotelId?: string) {
  const qc = useQueryClient();
  const { table, idCol } = PRES_ENTITIES[entity];
  return useMutation({
    mutationFn: async (entityId: string) => {
      if (!hotelId) throw new Error("No hotel selected.");
      const { error } = await sb().from(table).delete().eq("hotel_id", hotelId).eq(idCol, entityId);
      if (error) throw error;
      return entityId;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hotel-presentation"] }); },
  });
}
