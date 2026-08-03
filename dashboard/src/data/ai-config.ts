"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AiConfig } from "./ai-types";

const sb = () => getSupabaseBrowserClient();

export const acqk = {
  config: (h?: string) => ["ai", "aiConfig", h] as const,
  resolved: (h?: string) => ["ai", "aiConfigResolved", h] as const,
};

/** Editable facts only. Protected LOGIC (emergency routing, anti-hallucination,
 *  token security, QR handling, room-identity guards, fallback safety) lives in
 *  code and is never surfaced here. */
export const CONFIG_EDITABLE_FIELDS = [
  "persona", "tone", "response_formatting", "safe_handoff_text", "feature_flags", "retrieval_limit", "safe_keyword_aliases",
] as const;

export function useAiConfig(hotelId?: string) {
  return useQuery({
    queryKey: acqk.config(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<AiConfig | null> => {
      const { data, error } = await sb().from("ai_configs").select("*").eq("hotel_id", hotelId).maybeSingle();
      if (error) throw error;
      return (data as AiConfig) ?? null;
    },
  });
}

/** Live resolved config used by retrieval (published snapshot via RPC). */
export function useResolvedAiConfig(hotelId?: string) {
  return useQuery({
    queryKey: acqk.resolved(hotelId),
    enabled: !!hotelId,
    queryFn: async () => {
      const { data, error } = await sb().rpc("resolved_ai_config", { p_hotel: hotelId });
      if (error) throw error;
      return Array.isArray(data) ? data[0] ?? null : data ?? null;
    },
  });
}

export function useUpsertAiConfig(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<AiConfig>) => {
      const existing = await sb().from("ai_configs").select("id").eq("hotel_id", hotelId).maybeSingle();
      const patch: Record<string, unknown> = {};
      for (const k of CONFIG_EDITABLE_FIELDS) if (k in values) patch[k] = (values as any)[k];
      if (existing.data?.id) {
        const { error } = await sb().from("ai_configs").update(patch).eq("id", existing.data.id);
        if (error) throw error;
        return existing.data.id as string;
      }
      const { data, error } = await sb().from("ai_configs").insert({ ...patch, hotel_id: hotelId, status: "draft" }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: acqk.config(hotelId) }),
  });
}

export function usePublishAiConfig(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changeSummary }: { id: string; changeSummary?: string }) => {
      const { data, error } = await sb().rpc("publish_ai_config", { p_config: id, p_change_summary: changeSummary ?? null });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: acqk.config(hotelId) });
      qc.invalidateQueries({ queryKey: acqk.resolved(hotelId) });
    },
  });
}
