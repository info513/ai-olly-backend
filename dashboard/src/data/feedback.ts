"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { FeedbackSummary, FeedbackStatus } from "./reception-types";

const sb = () => getSupabaseBrowserClient();

export const fk = {
  feedback: (h?: string) => ["reception", "feedback", h] as const,
  item: (id?: string) => ["reception", "feedbackItem", id] as const,
};

const mapFeedback = (f: any): FeedbackSummary => ({
  id: f.id, rating: f.rating, category: f.category, message: f.message, followUpRequested: f.follow_up_requested,
  status: f.status as FeedbackStatus, assignedTo: f.assigned_to, stayId: f.stay_id, roomId: f.room_id,
  roomNumber: f.room?.room_number ?? null, createdAt: f.created_at, resolvedAt: f.resolved_at,
});

const SELECT = "id,rating,category,message,follow_up_requested,status,assigned_to,stay_id,room_id,created_at,resolved_at, room:rooms(room_number)";

export function useFeedback(hotelId?: string) {
  return useQuery({
    queryKey: fk.feedback(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<FeedbackSummary[]> => {
      const { data, error } = await sb().from("feedback").select(SELECT).eq("hotel_id", hotelId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapFeedback);
    },
  });
}

export function useUpdateFeedback(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { status?: FeedbackStatus; assignedTo?: string | null } }) => {
      const row: Record<string, unknown> = {};
      if ("status" in patch) { row.status = patch.status; if (patch.status === "resolved") row.resolved_at = new Date().toISOString(); }
      if ("assignedTo" in patch) row.assigned_to = patch.assignedTo;
      const { error } = await sb().from("feedback").update(row).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: fk.feedback(hotelId) }),
  });
}
