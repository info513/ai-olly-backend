"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { StaySummary, StayDetail, StayStatus } from "./reception-types";

const sb = () => getSupabaseBrowserClient();

export const sk = {
  stays: (h?: string) => ["reception", "stays", h] as const,
  stay: (id?: string) => ["reception", "stay", id] as const,
  roomsLite: (h?: string) => ["reception", "roomsLite", h] as const,
  guestStays: (g?: string) => ["reception", "guestStays", g] as const,
};

const guestName = (g: any): string | null => {
  if (!g) return null;
  if (g.pseudonymized_at) return "Former guest";
  const n = [g.first_name, g.last_name].filter(Boolean).join(" ");
  return n || null;
};

const mapStay = (s: any): StaySummary => ({
  id: s.id, status: s.status as StayStatus, roomId: s.room_id, roomNumber: s.room?.room_number ?? null,
  guestId: s.guest_id, guestName: guestName(s.guest), arrivalAt: s.arrival_at, departureAt: s.departure_at,
  checkedInAt: s.checked_in_at, checkedOutAt: s.checked_out_at,
});

const STAY_SELECT = "id,hotel_id,room_id,guest_id,status,arrival_at,departure_at,checked_in_at,checked_out_at,external_source,external_id,created_at,updated_at, room:rooms(room_number), guest:guests(first_name,last_name,pseudonymized_at)";

export function useStays(hotelId?: string) {
  return useQuery({
    queryKey: sk.stays(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<StaySummary[]> => {
      const { data, error } = await sb().from("stays").select(STAY_SELECT).eq("hotel_id", hotelId).order("arrival_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []).map(mapStay);
    },
  });
}

export function useStay(id?: string) {
  return useQuery({
    queryKey: sk.stay(id),
    enabled: !!id,
    queryFn: async (): Promise<StayDetail> => {
      const { data, error } = await sb().from("stays").select(STAY_SELECT).eq("id", id).single();
      if (error) throw error;
      const s = mapStay(data);
      return { ...s, hotelId: (data as any).hotel_id, externalSource: (data as any).external_source, externalId: (data as any).external_id, createdAt: (data as any).created_at, updatedAt: (data as any).updated_at };
    },
  });
}

export function useGuestStays(guestId?: string) {
  return useQuery({
    queryKey: sk.guestStays(guestId),
    enabled: !!guestId,
    queryFn: async (): Promise<StaySummary[]> => {
      const { data, error } = await sb().from("stays").select(STAY_SELECT).eq("guest_id", guestId).order("arrival_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []).map(mapStay);
    },
  });
}

/** Minimal room list for assignment (id + number); RLS-scoped to the hotel. */
export function useRoomsLite(hotelId?: string) {
  return useQuery({
    queryKey: sk.roomsLite(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<{ id: string; roomNumber: string }[]> => {
      const { data, error } = await sb().from("rooms").select("id,room_number").eq("hotel_id", hotelId).order("room_number");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ id: r.id, roomNumber: r.room_number }));
    },
  });
}

export interface CreateStayInput {
  guestId: string | null;
  roomId: string | null;
  arrivalAt: string | null;
  departureAt: string | null;
  externalSource?: string | null;
  externalId?: string | null;
  status?: StayStatus;
}

export function useCreateStay(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: CreateStayInput) => {
      const { data, error } = await sb().from("stays").insert({
        hotel_id: hotelId, guest_id: v.guestId, room_id: v.roomId, arrival_at: v.arrivalAt, departure_at: v.departureAt,
        external_source: v.externalSource ?? null, external_id: v.externalId ?? null, status: v.status ?? "reserved",
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: sk.stays(hotelId) }),
  });
}

function useStayPatch(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await sb().from("stays").update(patch).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: sk.stays(hotelId) }); qc.invalidateQueries({ queryKey: sk.stay(id) }); qc.invalidateQueries({ queryKey: ["reception", "guestStays"] }); },
  });
}

export function useUpdateStay(hotelId?: string) {
  const base = useStayPatch(hotelId);
  return {
    ...base,
    checkIn: (id: string) => base.mutateAsync({ id, patch: { status: "checked_in", checked_in_at: new Date().toISOString() } }),
    checkOut: (id: string) => base.mutateAsync({ id, patch: { status: "checked_out", checked_out_at: new Date().toISOString() } }),
    cancel: (id: string) => base.mutateAsync({ id, patch: { status: "cancelled" } }),
    reassignRoom: (id: string, roomId: string | null) => base.mutateAsync({ id, patch: { room_id: roomId } }),
    setDates: (id: string, arrivalAt: string | null, departureAt: string | null) => base.mutateAsync({ id, patch: { arrival_at: arrivalAt, departure_at: departureAt } }),
    setGuest: (id: string, guestId: string | null) => base.mutateAsync({ id, patch: { guest_id: guestId } }),
  };
}
