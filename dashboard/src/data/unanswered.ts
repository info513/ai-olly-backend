"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { UnansweredQuestion } from "./ai-types";

const sb = () => getSupabaseBrowserClient();

export const uqk = {
  list: (h?: string) => ["ai", "unanswered", h] as const,
};

export function useUnanswered(hotelId?: string) {
  return useQuery({
    queryKey: uqk.list(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<UnansweredQuestion[]> => {
      const { data, error } = await sb()
        .from("unanswered_questions")
        .select("id,hotel_id,normalized_question,original_question,occurrence_count,first_seen_at,last_seen_at,status,assigned_to,resolution_article_id,notes")
        .eq("hotel_id", hotelId)
        .order("occurrence_count", { ascending: false });
      if (error) throw error;
      return (data ?? []) as UnansweredQuestion[];
    },
  });
}

export function useUpdateUnanswered(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<UnansweredQuestion> }) => {
      const { error } = await sb().from("unanswered_questions").update(patch).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: uqk.list(hotelId) }),
  });
}
