"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const sb = () => getSupabaseBrowserClient();

// ── Domain types ──────────────────────────────────────────────────────────────
export type ContentStatus = "draft" | "preview" | "published" | "archived";
export type DestinationType = "city" | "island" | "municipality" | "resort_area" | "tourism_region";
export type ContentSourceType =
  | "manual" | "airtable_import" | "official_tourism" | "city_event_feed"
  | "external_api" | "partner" | "hotel_suggestion" | "ai_assisted_draft";
export type VerificationStatus = "unverified" | "verified" | "stale";

export interface Destination {
  id: string;
  name: string;
  slug: string;
  country_code: string | null;
  region: string | null;
  destination_type: DestinationType;
  timezone: string;
  default_locale: string;
  supported_locales: string[];
  latitude: number | null;
  longitude: number | null;
  short_description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  source_type: ContentSourceType;
  source_name: string | null;
  source_url: string | null;
  imported_at: string | null;
  last_verified_at: string | null;
  verification_status: VerificationStatus;
  rights_notes: string | null;
  status: ContentStatus;
  published_at: string | null;
  published_snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface DestinationListRow extends Destination {
  hotelCount: number;
  poiCount: number;
  routeCount: number;
  whisperCount: number;
  eventCount: number;
}

export interface DestinationVersion {
  id: string;
  version_number: number;
  status: ContentStatus;
  change_summary: string | null;
  created_by: string | null;
  published_at: string | null;
  created_at: string;
  snapshot: Record<string, unknown>;
}

export const DESTINATION_TYPES: { value: DestinationType; label: string }[] = [
  { value: "city", label: "City" },
  { value: "island", label: "Island" },
  { value: "municipality", label: "Municipality" },
  { value: "resort_area", label: "Resort area" },
  { value: "tourism_region", label: "Tourism region" },
];

export const SOURCE_TYPES: { value: ContentSourceType; label: string }[] = [
  { value: "manual", label: "Manual entry" },
  { value: "airtable_import", label: "Airtable import" },
  { value: "official_tourism", label: "Official tourism board" },
  { value: "city_event_feed", label: "City event feed" },
  { value: "external_api", label: "External API" },
  { value: "partner", label: "Partner" },
  { value: "hotel_suggestion", label: "Hotel suggestion" },
  { value: "ai_assisted_draft", label: "AI-assisted draft" },
];

export const VERIFICATION_STATUSES: { value: VerificationStatus; label: string }[] = [
  { value: "unverified", label: "Unverified" },
  { value: "verified", label: "Verified" },
  { value: "stale", label: "Stale" },
];

const LOCALE_RE = /^[a-z]{2}(-[a-z]{2})?$/;
export const isValidLocaleTag = (t: string) => LOCALE_RE.test(t.trim());

export const dqk = {
  list: () => ["platform", "destinations"] as const, // shared with the switcher/provider
  full: (filters?: unknown) => ["platform", "destinationsFull", filters] as const,
  one: (id?: string) => ["platform", "destination", id] as const,
  versions: (id?: string) => ["platform", "destinationVersions", id] as const,
  hotels: (id?: string) => ["platform", "destinationHotels", id] as const,
};

/** True when the working draft differs from the last published (live) snapshot. */
export function hasUnpublishedDestinationChanges(d: Destination): boolean {
  const s = d.published_snapshot as any;
  if (!s) return false;
  const pick = (o: any) => JSON.stringify({
    name: o.name ?? null, slug: o.slug ?? null, country_code: o.country_code ?? null, region: o.region ?? null,
    destination_type: o.destination_type ?? null, timezone: o.timezone ?? null, default_locale: o.default_locale ?? null,
    supported_locales: o.supported_locales ?? [], latitude: o.latitude ?? null, longitude: o.longitude ?? null,
    short_description: o.short_description ?? null, seo_title: o.seo_title ?? null, seo_description: o.seo_description ?? null,
    source_type: o.source_type ?? null, source_name: o.source_name ?? null, source_url: o.source_url ?? null,
    last_verified_at: o.last_verified_at ?? null, verification_status: o.verification_status ?? null, rights_notes: o.rights_notes ?? null,
  });
  return pick(d) !== pick(s);
}

// ── Filters ───────────────────────────────────────────────────────────────────
export interface DestinationFilters {
  search?: string;
  status?: ContentStatus | "all";
  type?: DestinationType | "all";
  country?: string | "all";
  verification?: VerificationStatus | "all";
  includeArchived?: boolean;
}

// ── List (with content + hotel counts) ─────────────────────────────────────────
export function useDestinationList(filters: DestinationFilters = {}) {
  return useQuery({
    queryKey: dqk.full(filters),
    queryFn: async (): Promise<DestinationListRow[]> => {
      const client = sb();
      let q = client.from("destinations").select("*").order("name", { ascending: true }).limit(500);
      if (!filters.includeArchived && (!filters.status || filters.status === "all")) q = q.neq("status", "archived");
      if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
      if (filters.type && filters.type !== "all") q = q.eq("destination_type", filters.type);
      if (filters.country && filters.country !== "all") q = q.eq("country_code", filters.country);
      if (filters.verification && filters.verification !== "all") q = q.eq("verification_status", filters.verification);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as Destination[];

      const term = filters.search?.trim().toLowerCase();
      if (term) rows = rows.filter((d) =>
        [d.name, d.slug, d.country_code, d.region, d.short_description].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)));

      // per-destination content + hotel counts (bounded: list ≤ 500)
      const counts = await Promise.all(rows.map(async (d) => {
        const head = (t: string) => client.from(t).select("id", { count: "exact", head: true }).eq("destination_id", d.id);
        const [h, p, r, w, e] = await Promise.all([
          head("hotels"), head("destination_pois"), head("destination_routes"),
          head("destination_whispers"), head("destination_events"),
        ]);
        const n = (x: any) => (x && !x.error ? x.count ?? 0 : 0);
        return { hotelCount: n(h), poiCount: n(p), routeCount: n(r), whisperCount: n(w), eventCount: n(e) };
      }));
      return rows.map((d, i) => ({ ...d, ...counts[i] }));
    },
  });
}

export function useDestination(id?: string) {
  return useQuery({
    queryKey: dqk.one(id),
    enabled: !!id,
    queryFn: async (): Promise<Destination> => {
      const { data, error } = await sb().from("destinations").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Destination;
    },
  });
}

export interface DestinationHotel { id: string; name: string; slug: string | null; }
export function useDestinationHotels(id?: string) {
  return useQuery({
    queryKey: dqk.hotels(id),
    enabled: !!id,
    queryFn: async (): Promise<DestinationHotel[]> => {
      const { data, error } = await sb().from("hotels").select("id,name,slug").eq("destination_id", id).order("name");
      if (error) throw error;
      return (data ?? []) as DestinationHotel[];
    },
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────────
type DestinationInput = Partial<Omit<Destination, "id" | "created_at" | "updated_at" | "published_snapshot" | "status">>;

export function useCreateDestination() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: DestinationInput): Promise<string> => {
      const { data, error } = await sb().from("destinations")
        .insert({ ...values, status: "draft" }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dqk.list() });
      qc.invalidateQueries({ queryKey: ["platform", "destinationsFull"] });
    },
  });
}

export function useUpdateDestination() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: DestinationInput }) => {
      const { error } = await sb().from("destinations").update(patch).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: dqk.one(id) });
      qc.invalidateQueries({ queryKey: dqk.list() });
      qc.invalidateQueries({ queryKey: ["platform", "destinationsFull"] });
    },
  });
}

export function usePublishDestination() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changeSummary }: { id: string; changeSummary?: string }) => {
      const { data, error } = await sb().rpc("publish_destination", { p_destination: id, p_change_summary: changeSummary ?? null });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: dqk.one(v.id) });
      qc.invalidateQueries({ queryKey: dqk.versions(v.id) });
      qc.invalidateQueries({ queryKey: dqk.list() });
      qc.invalidateQueries({ queryKey: ["platform", "destinationsFull"] });
    },
  });
}

export function useRollbackDestination() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, versionId }: { id: string; versionId: string }) => {
      const { data, error } = await sb().rpc("rollback_destination", { p_destination: id, p_version: versionId });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: dqk.one(v.id) });
      qc.invalidateQueries({ queryKey: dqk.versions(v.id) });
      qc.invalidateQueries({ queryKey: dqk.list() });
      qc.invalidateQueries({ queryKey: ["platform", "destinationsFull"] });
    },
  });
}

export function useDestinationVersions(id?: string) {
  return useQuery({
    queryKey: dqk.versions(id),
    enabled: !!id,
    queryFn: async (): Promise<DestinationVersion[]> => {
      const { data, error } = await sb().rpc("list_destination_versions", { p_destination: id });
      if (error) throw error;
      return (data ?? []) as DestinationVersion[];
    },
  });
}

/** Archive / restore are plain RLS-governed status writes (platform_admin UPDATE). */
export function useSetDestinationArchived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await sb().from("destinations")
        .update({ status: archived ? "archived" : "draft" }).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: dqk.one(id) });
      qc.invalidateQueries({ queryKey: dqk.list() });
      qc.invalidateQueries({ queryKey: ["platform", "destinationsFull"] });
    },
  });
}
