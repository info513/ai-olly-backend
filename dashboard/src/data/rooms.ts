"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { qk } from "./keys";
import type { Room, RoomType, ResolvedRoom } from "./types";

// Rooms: explicitly list columns — NEVER select '*' (access_token is column-protected).
const ROOM_COLUMNS =
  "id, hotel_id, room_type_id, room_number, active, floor, capacity_override, bed_configuration_override, view_description_override, smart_glass_override, smart_glass_instructions_override, window_mode_override, underfloor_heating_override, air_conditioning_note_override, extra_bed_available_override, room_features_override, room_notes_override, ai_welcome_override, updated_at";

const sb = () => getSupabaseBrowserClient();

// ── Room types ──────────────────────────────────────────────────────────────
async function fetchRoomTypes(hotelId: string): Promise<RoomType[]> {
  const { data, error } = await sb()
    .from("room_types")
    .select("*, rooms:rooms(count)")
    .eq("hotel_id", hotelId)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, roomCount: r.rooms?.[0]?.count ?? 0 }));
}

async function fetchRoomType(id: string): Promise<RoomType> {
  const { data, error } = await sb().from("room_types").select("*").eq("id", id).single();
  if (error) throw error;
  return data as RoomType;
}

export function useRoomTypes(hotelId?: string) {
  return useQuery({ queryKey: qk.roomTypes(hotelId), queryFn: () => fetchRoomTypes(hotelId!), enabled: !!hotelId });
}
export function useRoomType(id?: string) {
  return useQuery({ queryKey: qk.roomType(id), queryFn: () => fetchRoomType(id!), enabled: !!id });
}

export function useUpsertRoomType(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: Partial<RoomType> }) => {
      if (id) {
        const { data, error } = await sb().from("room_types").update(values).eq("id", id).select("*").single();
        if (error) throw error;
        return data as RoomType;
      }
      const { data, error } = await sb().from("room_types").insert({ ...values, hotel_id: hotelId }).select("*").single();
      if (error) throw error;
      return data as RoomType;
    },
    onSuccess: (rt) => {
      qc.invalidateQueries({ queryKey: qk.roomTypes(hotelId) });
      qc.invalidateQueries({ queryKey: qk.roomType(rt.id) });
      qc.invalidateQueries({ queryKey: qk.resolvedRooms(hotelId) });
    },
  });
}

// ── Rooms ───────────────────────────────────────────────────────────────────
async function fetchRooms(hotelId: string): Promise<Room[]> {
  const { data, error } = await sb().from("rooms").select(ROOM_COLUMNS).eq("hotel_id", hotelId).order("room_number");
  if (error) throw error;
  return (data ?? []) as unknown as Room[];
}
async function fetchRoom(id: string): Promise<Room> {
  const { data, error } = await sb().from("rooms").select(ROOM_COLUMNS).eq("id", id).single();
  if (error) throw error;
  return data as unknown as Room;
}
async function fetchResolvedRooms(hotelId: string): Promise<ResolvedRoom[]> {
  const { data, error } = await sb().from("resolved_rooms").select("*").eq("hotel_id", hotelId).order("room_number");
  if (error) throw error;
  return (data ?? []) as ResolvedRoom[];
}
async function fetchResolvedRoom(roomId: string): Promise<ResolvedRoom | null> {
  const { data, error } = await sb().from("resolved_rooms").select("*").eq("room_id", roomId).maybeSingle();
  if (error) throw error;
  return (data ?? null) as ResolvedRoom | null;
}

export function useRooms(hotelId?: string) {
  return useQuery({ queryKey: qk.rooms(hotelId), queryFn: () => fetchRooms(hotelId!), enabled: !!hotelId });
}
export function useRoom(id?: string) {
  return useQuery({ queryKey: qk.room(id), queryFn: () => fetchRoom(id!), enabled: !!id });
}
export function useResolvedRooms(hotelId?: string) {
  return useQuery({ queryKey: qk.resolvedRooms(hotelId), queryFn: () => fetchResolvedRooms(hotelId!), enabled: !!hotelId });
}
export function useResolvedRoom(roomId?: string) {
  return useQuery({ queryKey: qk.resolvedRoom(roomId), queryFn: () => fetchResolvedRoom(roomId!), enabled: !!roomId });
}

export function useUpdateRoom(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Room> }) => {
      // read-after-write with the safe column set (never returns access_token)
      const { error } = await sb().from("rooms").update(patch).eq("id", id);
      if (error) throw error;
      const { data, error: rerr } = await sb().from("rooms").select(ROOM_COLUMNS).eq("id", id).single();
      if (rerr) throw rerr;
      return data as unknown as Room;
    },
    onSuccess: (room) => {
      qc.invalidateQueries({ queryKey: qk.rooms(hotelId) });
      qc.invalidateQueries({ queryKey: qk.room(room.id) });
      qc.invalidateQueries({ queryKey: qk.resolvedRoom(room.id) });
      qc.invalidateQueries({ queryKey: qk.resolvedRooms(hotelId) });
    },
  });
}
