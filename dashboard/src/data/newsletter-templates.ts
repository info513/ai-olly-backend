"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { NewsletterTemplate, TemplateVersion } from "./newsletter-types";

const sb = () => getSupabaseBrowserClient();

export const tplk = {
  list: (h?: string) => ["newsletter", "templates", h] as const,
  item: (id?: string) => ["newsletter", "template", id] as const,
  versions: (id?: string) => ["newsletter", "templateVersions", id] as const,
};

const mapTpl = (t: any): NewsletterTemplate => ({
  id: t.id, hotelId: t.hotel_id, key: t.key, name: t.name, subject: t.subject, previewText: t.preview_text,
  content: t.content, locale: t.locale, status: t.status, headerAssetId: t.header_asset_id, publishedAt: t.published_at,
  publishedSnapshot: t.published_snapshot ?? null, updatedAt: t.updated_at,
});

/** Working draft differs from the live (last-published) snapshot. */
export function hasUnpublishedTemplateChanges(t: NewsletterTemplate): boolean {
  const s = t.publishedSnapshot;
  if (!s) return false;
  const pick = (subject: any, preview: any, content: any, name: any) => JSON.stringify({ subject: subject ?? null, preview: preview ?? null, content: content ?? null, name: name ?? null });
  return pick(t.subject, t.previewText, t.content, t.name) !== pick(s.subject, s.preview_text, s.content, s.name);
}

export function useTemplates(hotelId?: string) {
  return useQuery({
    queryKey: tplk.list(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<NewsletterTemplate[]> => {
      const { data, error } = await sb().from("newsletter_templates").select("*").or(`hotel_id.eq.${hotelId},hotel_id.is.null`).order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapTpl);
    },
  });
}

export function useTemplate(id?: string) {
  return useQuery({
    queryKey: tplk.item(id),
    enabled: !!id,
    queryFn: async (): Promise<NewsletterTemplate> => {
      const { data, error } = await sb().from("newsletter_templates").select("*").eq("id", id).single();
      if (error) throw error;
      return mapTpl(data);
    },
  });
}

export function useCreateTemplate(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { key: string; name: string; subject: string; locale: string; previewText?: string; content?: any }) => {
      const { data, error } = await sb().from("newsletter_templates").insert({
        hotel_id: hotelId, key: v.key, name: v.name, subject: v.subject, locale: v.locale, preview_text: v.previewText ?? null,
        content: v.content ?? { version: 1, blocks: [{ type: "paragraph", text: "" }] }, status: "draft",
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: tplk.list(hotelId) }),
  });
}

export function useUpdateTemplate(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<NewsletterTemplate> }) => {
      const row: Record<string, unknown> = {};
      if ("name" in patch) row.name = patch.name;
      if ("subject" in patch) row.subject = patch.subject;
      if ("previewText" in patch) row.preview_text = patch.previewText;
      if ("content" in patch) row.content = patch.content;
      if ("headerAssetId" in patch) row.header_asset_id = patch.headerAssetId;
      const { error } = await sb().from("newsletter_templates").update(row).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: tplk.list(hotelId) }); qc.invalidateQueries({ queryKey: tplk.item(id) }); },
  });
}

export function usePublishTemplate(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changeSummary }: { id: string; changeSummary?: string }) => {
      const { error } = await sb().rpc("publish_newsletter_template", { p_template: id, p_change_summary: changeSummary ?? null });
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: tplk.list(hotelId) }); qc.invalidateQueries({ queryKey: tplk.item(id) }); qc.invalidateQueries({ queryKey: tplk.versions(id) }); },
  });
}

export function useRollbackTemplate(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, versionId }: { id: string; versionId: string }) => {
      const { error } = await sb().rpc("rollback_newsletter_template", { p_template: id, p_version: versionId });
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: tplk.item(id) }); qc.invalidateQueries({ queryKey: tplk.versions(id) }); qc.invalidateQueries({ queryKey: tplk.list(hotelId) }); },
  });
}

export function useTemplateVersions(id?: string) {
  return useQuery({
    queryKey: tplk.versions(id),
    enabled: !!id,
    queryFn: async (): Promise<TemplateVersion[]> => {
      const { data, error } = await sb().rpc("list_newsletter_template_versions", { p_template: id });
      if (error) throw error;
      return (data ?? []).map((v: any): TemplateVersion => ({ id: v.id, versionNumber: v.version_number, status: v.status, changeSummary: v.change_summary, publishedAt: v.published_at, createdAt: v.created_at, snapshot: v.snapshot }));
    },
  });
}
