"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { KnowledgeArticle, KnowledgeCategory, KnowledgeAlias, ResolvedKnowledge, ArticleVersion } from "./ai-types";

const sb = () => getSupabaseBrowserClient();

export const kqk = {
  categories: (h?: string) => ["ai", "kbCategories", h] as const,
  articles: (h?: string) => ["ai", "kbArticles", h] as const,
  article: (id?: string) => ["ai", "kbArticle", id] as const,
  versions: (id?: string) => ["ai", "kbVersions", id] as const,
  resolved: (h?: string, locale?: string, preview?: boolean) => ["ai", "kbResolved", h, locale, preview] as const,
  aliases: (h?: string) => ["ai", "kbAliases", h] as const,
};

/** Working draft differs from the live snapshot (edits not yet published). */
export function hasUnpublishedArticleChanges(a: KnowledgeArticle): boolean {
  const s = a.published_snapshot;
  if (!s) return false;
  const pick = (o: any) => JSON.stringify({
    title: o.title ?? null, approved_answer: o.approved_answer ?? null, body_content: o.body_content ?? null,
    is_critical: !!o.is_critical, available_to_ai: !!o.available_to_ai, active: !!o.active,
    priority: o.priority ?? 0, category_id: o.category_id ?? null, valid_from: o.valid_from ?? null, valid_to: o.valid_to ?? null,
  });
  return pick(a) !== pick(s);
}

// ── Categories ──────────────────────────────────────────────────────────────
export function useKnowledgeCategories(hotelId?: string) {
  return useQuery({
    queryKey: kqk.categories(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<KnowledgeCategory[]> => {
      const { data, error } = await sb().from("knowledge_categories").select("id,hotel_id,key,name,sort_order,active").or(`hotel_id.is.null,hotel_id.eq.${hotelId}`).order("sort_order");
      if (error) throw error;
      return (data ?? []) as KnowledgeCategory[];
    },
  });
}

// ── Articles ────────────────────────────────────────────────────────────────
export function useKnowledgeArticles(hotelId?: string) {
  return useQuery({
    queryKey: kqk.articles(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<KnowledgeArticle[]> => {
      const { data, error } = await sb().from("knowledge_articles").select("*, category:knowledge_categories(name)").or(`hotel_id.eq.${hotelId},hotel_id.is.null`).order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((a: any) => ({ ...a, categoryName: a.category?.name ?? null }));
    },
  });
}
export function useKnowledgeArticle(id?: string) {
  return useQuery({
    queryKey: kqk.article(id),
    enabled: !!id,
    queryFn: async (): Promise<KnowledgeArticle> => {
      const { data, error } = await sb().from("knowledge_articles").select("*, category:knowledge_categories(name)").eq("id", id).single();
      if (error) throw error;
      return { ...(data as any), categoryName: (data as any).category?.name ?? null };
    },
  });
}

export function useCreateArticle(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<KnowledgeArticle>) => {
      const { data, error } = await sb().from("knowledge_articles").insert({ ...values, hotel_id: hotelId, status: "draft" }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: kqk.articles(hotelId) }),
  });
}
export function useUpdateArticle(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<KnowledgeArticle> }) => {
      const { error } = await sb().from("knowledge_articles").update(patch).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: kqk.articles(hotelId) });
      qc.invalidateQueries({ queryKey: kqk.article(id) });
      qc.invalidateQueries({ queryKey: ["ai", "kbResolved", hotelId] });
    },
  });
}

// ── Publishing / rollback / history (real RPCs) ──────────────────────────────
export function usePublishArticle(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changeSummary, acknowledgeCritical }: { id: string; changeSummary?: string; acknowledgeCritical?: boolean }) => {
      const { data, error } = await sb().rpc("publish_knowledge_article", { p_article: id, p_change_summary: changeSummary ?? null, p_acknowledge_critical: acknowledgeCritical ?? false });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: kqk.articles(hotelId) });
      qc.invalidateQueries({ queryKey: kqk.article(v.id) });
      qc.invalidateQueries({ queryKey: kqk.versions(v.id) });
      qc.invalidateQueries({ queryKey: ["ai", "kbResolved", hotelId] });
    },
  });
}
export function useRollbackArticle(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, versionId }: { id: string; versionId: string }) => {
      const { data, error } = await sb().rpc("rollback_knowledge_article", { p_article: id, p_version: versionId });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: kqk.article(v.id) });
      qc.invalidateQueries({ queryKey: kqk.versions(v.id) });
      qc.invalidateQueries({ queryKey: kqk.articles(hotelId) });
    },
  });
}
export function useArticleVersions(id?: string) {
  return useQuery({
    queryKey: kqk.versions(id),
    enabled: !!id,
    queryFn: async (): Promise<ArticleVersion[]> => {
      const { data, error } = await sb().rpc("list_article_versions", { p_article: id });
      if (error) throw error;
      return (data ?? []) as ArticleVersion[];
    },
  });
}

// ── Resolved AI knowledge (real RPC; live vs preview) ────────────────────────
export function useResolvedKnowledge(hotelId?: string, locale = "en", preview = false) {
  return useQuery({
    queryKey: kqk.resolved(hotelId, locale, preview),
    enabled: !!hotelId,
    queryFn: async (): Promise<ResolvedKnowledge[]> => {
      const { data, error } = await sb().rpc("resolved_ai_knowledge", { p_hotel: hotelId, p_locale: locale, p_preview: preview });
      if (error) throw error;
      return (data ?? []) as ResolvedKnowledge[];
    },
  });
}

// ── Aliases ──────────────────────────────────────────────────────────────────
export function useAliases(hotelId?: string) {
  return useQuery({
    queryKey: kqk.aliases(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<KnowledgeAlias[]> => {
      const { data, error } = await sb().from("knowledge_aliases").select("*, article:knowledge_articles(title)").or(`hotel_id.is.null,hotel_id.eq.${hotelId}`).order("normalized_alias");
      if (error) throw error;
      return (data ?? []).map((a: any) => ({ ...a, articleTitle: a.article?.title ?? null }));
    },
  });
}
export function useUpsertAlias(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: Partial<KnowledgeAlias> }) => {
      if (id) { const { error } = await sb().from("knowledge_aliases").update(values).eq("id", id); if (error) throw error; return id; }
      const { data, error } = await sb().from("knowledge_aliases").insert({ ...values, hotel_id: hotelId }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: kqk.aliases(hotelId) }),
  });
}
export function useDeleteAlias(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await sb().from("knowledge_aliases").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: kqk.aliases(hotelId) }),
  });
}
