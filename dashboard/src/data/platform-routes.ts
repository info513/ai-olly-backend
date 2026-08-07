"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { BlockBody } from "./types";
import type { ContentStatus, ContentSourceType, VerificationStatus } from "./platform-destinations";

const sb = () => getSupabaseBrowserClient();

export type { ContentStatus, ContentSourceType, VerificationStatus } from "./platform-destinations";
export { SOURCE_TYPES, VERIFICATION_STATUSES } from "./platform-destinations";
// Reused for the waypoint POI picker + canonical media picker.
export { usePois, usePublicAssets, POI_CATEGORIES } from "./platform-pois";
export type { Poi, PublicAsset } from "./platform-pois";

export type RouteType = "walking" | "cycling" | "driving" | "cultural" | "historical" | "family" | "accessible";
export type RouteDifficulty = "easy" | "moderate" | "challenging";

export const ROUTE_TYPES: { value: RouteType; label: string }[] = [
  { value: "walking", label: "Walking" }, { value: "cycling", label: "Cycling" },
  { value: "driving", label: "Driving" }, { value: "cultural", label: "Cultural" },
  { value: "historical", label: "Historical" }, { value: "family", label: "Family" },
  { value: "accessible", label: "Accessible" },
];
export const ROUTE_DIFFICULTIES: { value: RouteDifficulty; label: string }[] = [
  { value: "easy", label: "Easy" }, { value: "moderate", label: "Moderate" }, { value: "challenging", label: "Challenging" },
];

/** One ordered stop on a route. References a POI by id (structured, not free text). */
export interface Waypoint { poi_id: string; poi_key: string | null; note: string | null; }
export interface WaypointsJson { version?: number; stops?: Waypoint[]; pois?: string[]; order?: string[]; [k: string]: unknown; }

export interface Route {
  id: string;
  destination_id: string;
  key: string;
  name: string;
  route_type: RouteType;
  short_description: string | null;
  body_content: BlockBody | null;
  difficulty: RouteDifficulty | null;
  distance_km: number | null;
  duration_minutes: number | null;
  waypoints: WaypointsJson | null;
  start_location: string | null;
  end_location: string | null;
  map_url: string | null;
  polyline: string | null;
  accessibility_info: string | null;
  safety_notes: string | null;
  seasonality: string | null;
  recommended_equipment: string | null;
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

export interface RouteVersion {
  id: string;
  version_number: number;
  status: ContentStatus;
  change_summary: string | null;
  created_by: string | null;
  published_at: string | null;
  created_at: string;
  snapshot: Record<string, unknown>;
}

export interface RouteHotelUsage {
  hotelsInDestination: number;
  customized: number;
  hiddenBy: number;
  featuredBy: number;
  recommendations: number;
  orderOverrides: number;
  imageOverrides: number;
}

const KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const isValidRouteKey = (k: string) => KEY_RE.test(k);

/** Extract the ordered stops from a waypoints jsonb, deriving from legacy
 *  {order|pois:[key]} when a canonical `stops` array is absent. */
export function readStops(waypoints: WaypointsJson | null | undefined, poisByKey?: Map<string, { id: string; key: string }>): Waypoint[] {
  if (!waypoints) return [];
  if (Array.isArray(waypoints.stops)) return waypoints.stops.filter((s) => !!s?.poi_id);
  const keys = (waypoints.order && waypoints.order.length ? waypoints.order : waypoints.pois) ?? [];
  if (!poisByKey) return [];
  return keys
    .map((k) => { const p = poisByKey.get(k); return p ? { poi_id: p.id, poi_key: p.key, note: null } : null; })
    .filter(Boolean) as Waypoint[];
}

/** Serialize stops to the waypoints jsonb, keeping legacy pois/order in sync. */
export function writeStops(stops: Waypoint[]): WaypointsJson {
  const keys = stops.map((s) => s.poi_key).filter(Boolean) as string[];
  return { version: 1, stops: stops.map((s) => ({ poi_id: s.poi_id, poi_key: s.poi_key, note: s.note?.trim() || null })), pois: keys, order: keys };
}

export const rqk = {
  list: (destId?: string, filters?: unknown) => ["platform", "routes", destId, filters] as const,
  one: (id?: string) => ["platform", "route", id] as const,
  versions: (id?: string) => ["platform", "routeVersions", id] as const,
  usage: (id?: string) => ["platform", "routeUsage", id] as const,
};

export function hasUnpublishedRouteChanges(r: Route): boolean {
  const s = r.published_snapshot as any;
  if (!s) return false;
  const stops = (w: any) => JSON.stringify((w?.stops ?? []).map((x: any) => ({ p: x.poi_id, n: x.note ?? null })));
  const pick = (o: any) => JSON.stringify({
    key: o.key ?? null, name: o.name ?? null, route_type: o.route_type ?? null, short_description: o.short_description ?? null,
    body_content: o.body_content ?? null, difficulty: o.difficulty ?? null, distance_km: o.distance_km ?? null, duration_minutes: o.duration_minutes ?? null,
    start_location: o.start_location ?? null, end_location: o.end_location ?? null, map_url: o.map_url ?? null, polyline: o.polyline ?? null,
    accessibility_info: o.accessibility_info ?? null, safety_notes: o.safety_notes ?? null, seasonality: o.seasonality ?? null, recommended_equipment: o.recommended_equipment ?? null,
    valid_from: o.valid_from ?? null, valid_to: o.valid_to ?? null,
    source_type: o.source_type ?? null, source_name: o.source_name ?? null, source_url: o.source_url ?? null,
    last_verified_at: o.last_verified_at ?? null, verification_status: o.verification_status ?? null, rights_notes: o.rights_notes ?? null,
    featured_default: !!o.featured_default, canonical_asset_id: o.canonical_asset_id ?? null, active: o.active ?? true,
    waypoints: stops(o.waypoints),
  });
  return pick(r) !== pick(s);
}

export interface RouteFilters {
  search?: string;
  status?: ContentStatus | "all";
  routeType?: RouteType | "all";
  difficulty?: RouteDifficulty | "all";
  verification?: VerificationStatus | "all";
  includeArchived?: boolean;
}

export function useRoutes(destinationId?: string, filters: RouteFilters = {}) {
  return useQuery({
    queryKey: rqk.list(destinationId, filters),
    enabled: !!destinationId,
    queryFn: async (): Promise<Route[]> => {
      let q = sb().from("destination_routes").select("*").eq("destination_id", destinationId)
        .order("sort_order", { ascending: true }).order("name", { ascending: true }).limit(1000);
      if (!filters.includeArchived && (!filters.status || filters.status === "all")) q = q.neq("status", "archived");
      if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
      if (filters.routeType && filters.routeType !== "all") q = q.eq("route_type", filters.routeType);
      if (filters.difficulty && filters.difficulty !== "all") q = q.eq("difficulty", filters.difficulty);
      if (filters.verification && filters.verification !== "all") q = q.eq("verification_status", filters.verification);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as Route[];
      const term = filters.search?.trim().toLowerCase();
      if (term) rows = rows.filter((r) =>
        [r.name, r.key, r.short_description, r.start_location, r.end_location].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)));
      return rows;
    },
  });
}

export function useRoute(id?: string) {
  return useQuery({
    queryKey: rqk.one(id),
    enabled: !!id,
    queryFn: async (): Promise<Route> => {
      const { data, error } = await sb().from("destination_routes").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Route;
    },
  });
}

export function useRouteHotelUsage(routeId?: string, destinationId?: string) {
  return useQuery({
    queryKey: rqk.usage(routeId),
    enabled: !!routeId,
    queryFn: async (): Promise<RouteHotelUsage> => {
      const client = sb();
      const [settings, hotels] = await Promise.all([
        client.from("hotel_route_settings").select("hotel_id,visible,featured,sort_order_override,hotel_recommendation,hotel_photo_url").eq("route_id", routeId),
        destinationId ? client.from("hotels").select("id", { count: "exact", head: true }).eq("destination_id", destinationId) : Promise.resolve({ count: 0 } as any),
      ]);
      const rows = (settings.data ?? []) as any[];
      const nonEmpty = (v: any) => typeof v === "string" && v.trim().length > 0;
      return {
        hotelsInDestination: (hotels as any).count ?? 0,
        customized: rows.length,
        hiddenBy: rows.filter((r) => r.visible === false).length,
        featuredBy: rows.filter((r) => r.featured === true).length,
        recommendations: rows.filter((r) => nonEmpty(r.hotel_recommendation)).length,
        orderOverrides: rows.filter((r) => r.sort_order_override !== null && r.sort_order_override !== undefined).length,
        imageOverrides: rows.filter((r) => nonEmpty(r.hotel_photo_url)).length,
      };
    },
  });
}

type RouteInput = Partial<Omit<Route, "id" | "created_at" | "updated_at" | "published_snapshot" | "status">>;
const invalidate = (qc: ReturnType<typeof useQueryClient>, id?: string) => {
  qc.invalidateQueries({ queryKey: ["platform", "routes"] });
  if (id) { qc.invalidateQueries({ queryKey: rqk.one(id) }); qc.invalidateQueries({ queryKey: rqk.versions(id) }); }
};

export function useCreateRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: RouteInput & { destination_id: string; key: string; name: string }): Promise<string> => {
      const { data, error } = await sb().from("destination_routes").insert({ ...values, status: "draft" }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: RouteInput }) => {
      const { error } = await sb().from("destination_routes").update(patch).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => invalidate(qc, id),
  });
}

export function usePublishRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changeSummary }: { id: string; changeSummary?: string }) => {
      const { data, error } = await sb().rpc("publish_route", { p_route: id, p_change_summary: changeSummary ?? null });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => invalidate(qc, v.id),
  });
}

export function useRollbackRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, versionId }: { id: string; versionId: string }) => {
      const { data, error } = await sb().rpc("rollback_route", { p_route: id, p_version: versionId });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => invalidate(qc, v.id),
  });
}

export function useRouteVersions(id?: string) {
  return useQuery({
    queryKey: rqk.versions(id),
    enabled: !!id,
    queryFn: async (): Promise<RouteVersion[]> => {
      const { data, error } = await sb().rpc("list_route_versions", { p_route: id });
      if (error) throw error;
      return (data ?? []) as RouteVersion[];
    },
  });
}

export function useSetRouteArchived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await sb().from("destination_routes").update({ status: archived ? "archived" : "draft" }).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => invalidate(qc, id),
  });
}
