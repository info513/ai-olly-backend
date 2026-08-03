"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { qk } from "./keys";
import type { HotelService, ResolvedService, ServiceCategory, ServiceVersion } from "./types";

const sb = () => getSupabaseBrowserClient();

/**
 * True when the working (draft) row differs from the currently-LIVE snapshot —
 * i.e. there are edits guests won't see until the next publish. Never-published
 * services (no snapshot) are not "pending"; they're simply unpublished.
 */
export function hasUnpublishedChanges(s: HotelService): boolean {
  const snap = s.published_snapshot;
  if (!snap) return false;
  const pick = (o: any) => ({
    title: o.title ?? null,
    short_description: o.short_description ?? null,
    body_content: o.body_content ?? null,
    is_critical: !!o.is_critical,
    visible_in_pwa: !!o.visible_in_pwa,
    visible_in_web: !!o.visible_in_web,
    available_to_ai: !!o.available_to_ai,
    active: !!o.active,
    category_id: o.category_id ?? null,
    sort_order: o.sort_order ?? 0,
    valid_from: o.valid_from ?? null,
    valid_to: o.valid_to ?? null,
  });
  return JSON.stringify(pick(s)) !== JSON.stringify(pick(snap));
}

// ── Categories ──────────────────────────────────────────────────────────────
async function fetchCategories(hotelId: string): Promise<ServiceCategory[]> {
  const { data, error } = await sb()
    .from("service_categories")
    .select("id, hotel_id, key, name, sort_order, active, hotel_services(count)")
    .or(`hotel_id.is.null,hotel_id.eq.${hotelId}`)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((c: any) => ({ ...c, serviceCount: c.hotel_services?.[0]?.count ?? 0 }));
}
export function useCategories(hotelId?: string) {
  return useQuery({ queryKey: qk.categories(hotelId), queryFn: () => fetchCategories(hotelId!), enabled: !!hotelId });
}

// ── Services ────────────────────────────────────────────────────────────────
async function fetchServices(hotelId: string): Promise<HotelService[]> {
  const { data, error } = await sb()
    .from("hotel_services")
    .select("*, category:service_categories(name)")
    .or(`hotel_id.eq.${hotelId},hotel_id.is.null`)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((s: any) => ({ ...s, categoryName: s.category?.name ?? null }));
}
async function fetchService(id: string): Promise<HotelService> {
  const { data, error } = await sb().from("hotel_services").select("*, category:service_categories(name)").eq("id", id).single();
  if (error) throw error;
  return { ...(data as any), categoryName: (data as any).category?.name ?? null };
}

export function useServices(hotelId?: string) {
  return useQuery({ queryKey: qk.services(hotelId), queryFn: () => fetchServices(hotelId!), enabled: !!hotelId });
}
export function useService(id?: string) {
  return useQuery({ queryKey: qk.service(id), queryFn: () => fetchService(id!), enabled: !!id });
}

export function useCreateService(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<HotelService>) => {
      const { data, error } = await sb().from("hotel_services").insert({ ...values, hotel_id: hotelId, status: "draft" }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.services(hotelId) }),
  });
}

export function useUpdateService(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<HotelService> }) => {
      const { error } = await sb().from("hotel_services").update(patch).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: qk.services(hotelId) });
      qc.invalidateQueries({ queryKey: qk.service(id) });
      qc.invalidateQueries({ queryKey: qk.resolvedServices(hotelId) });
    },
  });
}

// ── Publishing / rollback (real RPCs) ────────────────────────────────────────
export function usePublishService(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changeSummary, acknowledgeCritical }: { id: string; changeSummary?: string; acknowledgeCritical?: boolean }) => {
      const { data, error } = await sb().rpc("publish_hotel_service", {
        p_service: id,
        p_change_summary: changeSummary ?? null,
        p_acknowledge_critical: acknowledgeCritical ?? false,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.services(hotelId) });
      qc.invalidateQueries({ queryKey: qk.service(vars.id) });
      qc.invalidateQueries({ queryKey: qk.serviceVersions(vars.id) });
      qc.invalidateQueries({ queryKey: qk.resolvedServices(hotelId) });
    },
  });
}

export function useRollbackService(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, versionId }: { id: string; versionId: string }) => {
      const { data, error } = await sb().rpc("rollback_hotel_service", { p_service: id, p_version: versionId });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qk.service(vars.id) });
      qc.invalidateQueries({ queryKey: qk.serviceVersions(vars.id) });
      qc.invalidateQueries({ queryKey: qk.services(hotelId) });
      qc.invalidateQueries({ queryKey: qk.resolvedServices(hotelId) });
    },
  });
}

async function fetchVersions(id: string): Promise<ServiceVersion[]> {
  const { data, error } = await sb().rpc("list_service_versions", { p_service: id });
  if (error) throw error;
  return (data ?? []) as ServiceVersion[];
}
export function useServiceVersions(id?: string) {
  return useQuery({ queryKey: qk.serviceVersions(id), queryFn: () => fetchVersions(id!), enabled: !!id });
}

// ── Resolved services (real RPC) ─────────────────────────────────────────────
async function fetchResolvedServices(hotelId: string): Promise<ResolvedService[]> {
  const { data, error } = await sb().rpc("resolved_hotel_services", { p_hotel: hotelId });
  if (error) throw error;
  return (data ?? []) as ResolvedService[];
}
export function useResolvedServices(hotelId?: string) {
  return useQuery({ queryKey: qk.resolvedServices(hotelId), queryFn: () => fetchResolvedServices(hotelId!), enabled: !!hotelId });
}
