"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Campaign, CampaignStatus } from "./newsletter-types";

const sb = () => getSupabaseBrowserClient();

export const camk = {
  list: (h?: string) => ["newsletter", "campaigns", h] as const,
  item: (id?: string) => ["newsletter", "campaign", id] as const,
};

const mapCampaign = (c: any): Campaign => ({
  id: c.id, hotelId: c.hotel_id, name: c.name, templateId: c.template_id, segmentId: c.segment_id,
  subjectSnapshot: c.subject_snapshot, previewTextSnapshot: c.preview_text_snapshot, contentSnapshot: c.content_snapshot,
  segmentSnapshot: c.segment_snapshot, status: c.status, scheduledAt: c.scheduled_at, sentAt: c.sent_at, brevoCampaignId: c.brevo_campaign_id,
  totals: { recipients: c.recipient_total ?? 0, delivered: c.delivered_total ?? 0, opened: c.opened_total ?? 0, clicked: c.clicked_total ?? 0, bounced: c.bounced_total ?? 0, unsubscribed: c.unsubscribed_total ?? 0 },
  createdAt: c.created_at, templateName: c.template?.name ?? null, segmentName: c.segment?.name ?? null,
});

const SELECT = "*, template:newsletter_templates(name), segment:newsletter_segments(name)";

export function useCampaigns(hotelId?: string) {
  return useQuery({
    queryKey: camk.list(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<Campaign[]> => {
      const { data, error } = await sb().from("newsletter_campaigns").select(SELECT).eq("hotel_id", hotelId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapCampaign);
    },
  });
}

export function useCampaign(id?: string) {
  return useQuery({
    queryKey: camk.item(id),
    enabled: !!id,
    queryFn: async (): Promise<Campaign> => {
      const { data, error } = await sb().from("newsletter_campaigns").select(SELECT).eq("id", id).single();
      if (error) throw error;
      return mapCampaign(data);
    },
  });
}

export function useCreateCampaign(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { name: string; templateId?: string | null; segmentId?: string | null }) => {
      const { data, error } = await sb().from("newsletter_campaigns").insert({ hotel_id: hotelId, name: v.name, template_id: v.templateId ?? null, segment_id: v.segmentId ?? null, status: "draft" }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: camk.list(hotelId) }),
  });
}

export function useUpdateCampaign(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { name?: string; templateId?: string | null; segmentId?: string | null; status?: CampaignStatus } }) => {
      const row: Record<string, unknown> = {};
      if ("name" in patch) row.name = patch.name;
      if ("templateId" in patch) row.template_id = patch.templateId;
      if ("segmentId" in patch) row.segment_id = patch.segmentId;
      if ("status" in patch) row.status = patch.status;
      const { error } = await sb().from("newsletter_campaigns").update(row).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: camk.list(hotelId) }); qc.invalidateQueries({ queryKey: camk.item(id) }); },
  });
}

/** Freeze + schedule via the DB function (snapshots template + segment). */
export function useScheduleCampaign(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, scheduledAt }: { id: string; scheduledAt: string }) => {
      const { error } = await sb().rpc("schedule_campaign", { p_campaign: id, p_scheduled_at: scheduledAt });
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: camk.list(hotelId) }); qc.invalidateQueries({ queryKey: camk.item(id) }); },
  });
}

export function useCancelCampaign(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await sb().from("newsletter_campaigns").update({ status: "cancelled" }).eq("id", id); if (error) throw error; return id; },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: camk.list(hotelId) }); qc.invalidateQueries({ queryKey: camk.item(id) }); },
  });
}

export function useDuplicateCampaign(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: Campaign) => {
      const { data, error } = await sb().from("newsletter_campaigns").insert({ hotel_id: hotelId, name: `${c.name} (copy)`, template_id: c.templateId, segment_id: c.segmentId, status: "draft" }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: camk.list(hotelId) }),
  });
}
