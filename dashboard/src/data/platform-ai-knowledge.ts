"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { BlockBody } from "./types";
import type { ContentStatus } from "./platform-destinations";

const sb = () => getSupabaseBrowserClient();
export type { ContentStatus } from "./platform-destinations";

// Destination-scoped canonical knowledge (hotel_id null, source_type 'destination').
// Reuses the existing knowledge_articles model, RLS, and publish/rollback/history
// RPCs — RLS already gates hotel_id-null writes to platform_admin.
export interface DestArticle {
  id: string; hotel_id: string | null; destination_id: string | null; category_id: string | null;
  key: string; title: string; body_content: BlockBody | null; approved_answer: string | null; locale: string;
  status: ContentStatus; active: boolean; available_to_ai: boolean; source_type: string; priority: number; is_critical: boolean;
  valid_from: string | null; valid_to: string | null; published_at: string | null; published_snapshot: Record<string, unknown> | null;
  created_at: string; updated_at: string;
}
export interface ArticleVersion { id: string; version_number: number; status: ContentStatus; change_summary: string | null; created_by: string | null; published_at: string | null; created_at: string; snapshot: Record<string, unknown>; }
export interface KCategory { id: string; key: string; name: string; }
export interface DestAlias { id: string; article_id: string | null; alias_text: string; locale: string; active: boolean; intent_key: string | null; }

const KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/; export const isValidArticleKey = (k: string) => KEY_RE.test(k);
export const akqk = { list: (d?: string, f?: unknown) => ["platform", "ai", d, f] as const, one: (id?: string) => ["platform", "aiArticle", id] as const, versions: (id?: string) => ["platform", "aiVersions", id] as const, aliases: (d?: string) => ["platform", "aiAliases", d] as const, cats: () => ["platform", "aiCats"] as const };

export function hasUnpublishedArticleChanges(a: DestArticle): boolean {
  const s = a.published_snapshot as any; if (!s) return false;
  const pick = (o: any) => JSON.stringify({ key: o.key ?? null, title: o.title ?? null, body_content: o.body_content ?? null, approved_answer: o.approved_answer ?? null, category_id: o.category_id ?? null, priority: o.priority ?? 0, is_critical: !!o.is_critical, available_to_ai: !!o.available_to_ai, active: o.active ?? true, valid_from: o.valid_from ?? null, valid_to: o.valid_to ?? null });
  return pick(a) !== pick(s);
}

export interface ArticleFilters { search?: string; status?: ContentStatus | "all"; visibility?: "all" | "ai" | "hidden"; critical?: boolean; includeArchived?: boolean; }

export function useDestArticles(destinationId?: string, filters: ArticleFilters = {}) {
  return useQuery({
    queryKey: akqk.list(destinationId, filters), enabled: !!destinationId,
    queryFn: async (): Promise<DestArticle[]> => {
      let q = sb().from("knowledge_articles").select("*").eq("destination_id", destinationId).is("hotel_id", null).order("priority", { ascending: false }).order("title").limit(1000);
      if (!filters.includeArchived && (!filters.status || filters.status === "all")) q = q.neq("status", "archived");
      if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
      if (filters.visibility === "ai") q = q.eq("available_to_ai", true);
      if (filters.visibility === "hidden") q = q.eq("available_to_ai", false);
      if (filters.critical) q = q.eq("is_critical", true);
      const { data, error } = await q; if (error) throw error;
      let rows = (data ?? []) as DestArticle[];
      const term = filters.search?.trim().toLowerCase();
      if (term) rows = rows.filter((a) => [a.title, a.key, a.approved_answer].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)));
      return rows;
    },
  });
}
export function useDestArticle(id?: string) { return useQuery({ queryKey: akqk.one(id), enabled: !!id, queryFn: async (): Promise<DestArticle> => { const { data, error } = await sb().from("knowledge_articles").select("*").eq("id", id).maybeSingle(); if (error) throw error; return data as DestArticle; } }); }
export function useKCategories() { return useQuery({ queryKey: akqk.cats(), queryFn: async (): Promise<KCategory[]> => { const { data, error } = await sb().from("knowledge_categories").select("id,key,name").is("hotel_id", null).eq("active", true).order("sort_order"); if (error) throw error; return (data ?? []) as KCategory[]; } }); }

type ArticleInput = Partial<Omit<DestArticle, "id" | "created_at" | "updated_at" | "published_snapshot" | "status">>;
const inv = (qc: ReturnType<typeof useQueryClient>, id?: string) => { qc.invalidateQueries({ queryKey: ["platform", "ai"] }); if (id) { qc.invalidateQueries({ queryKey: akqk.one(id) }); qc.invalidateQueries({ queryKey: akqk.versions(id) }); } };

export function useCreateDestArticle() { const qc = useQueryClient(); return useMutation({ mutationFn: async (v: ArticleInput & { destination_id: string; key: string; title: string; locale: string }): Promise<string> => { const { data, error } = await sb().from("knowledge_articles").insert({ ...v, hotel_id: null, source_type: "destination", status: "draft" }).select("id").single(); if (error) throw error; return data.id as string; }, onSuccess: () => inv(qc) }); }
export function useUpdateDestArticle() { const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, patch }: { id: string; patch: ArticleInput }) => { const { error } = await sb().from("knowledge_articles").update(patch).eq("id", id); if (error) throw error; return id; }, onSuccess: (id) => inv(qc, id) }); }
export function usePublishDestArticle() { const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, changeSummary, acknowledgeCritical }: { id: string; changeSummary?: string; acknowledgeCritical?: boolean }) => { const { data, error } = await sb().rpc("publish_knowledge_article", { p_article: id, p_change_summary: changeSummary ?? null, p_acknowledge_critical: acknowledgeCritical ?? false }); if (error) throw error; return data; }, onSuccess: (_d, v) => inv(qc, v.id) }); }
export function useRollbackDestArticle() { const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, versionId }: { id: string; versionId: string }) => { const { data, error } = await sb().rpc("rollback_knowledge_article", { p_article: id, p_version: versionId }); if (error) throw error; return data; }, onSuccess: (_d, v) => inv(qc, v.id) }); }
export function useDestArticleVersions(id?: string) { return useQuery({ queryKey: akqk.versions(id), enabled: !!id, queryFn: async (): Promise<ArticleVersion[]> => { const { data, error } = await sb().rpc("list_article_versions", { p_article: id }); if (error) throw error; return (data ?? []) as ArticleVersion[]; } }); }
export function useSetDestArticleArchived() { const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => { const { error } = await sb().from("knowledge_articles").update({ status: archived ? "archived" : "draft" }).eq("id", id); if (error) throw error; return id; }, onSuccess: (id) => inv(qc, id) }); }

// ── Aliases (destination-scoped: hotel_id null, article → destination article) ──
export function useDestAliases(articleId?: string) {
  return useQuery({ queryKey: ["platform", "aiAliases", articleId], enabled: !!articleId, queryFn: async (): Promise<DestAlias[]> => { const { data, error } = await sb().from("knowledge_aliases").select("id,article_id,alias_text,locale,active,intent_key").eq("article_id", articleId).order("alias_text"); if (error) throw error; return (data ?? []) as DestAlias[]; } });
}
export function useAddDestAlias() { const qc = useQueryClient(); return useMutation({ mutationFn: async ({ articleId, aliasText, locale }: { articleId: string; aliasText: string; locale: string }) => { const { error } = await sb().from("knowledge_aliases").insert({ article_id: articleId, hotel_id: null, alias_text: aliasText, locale, active: true }); if (error) throw error; return articleId; }, onSuccess: (articleId) => qc.invalidateQueries({ queryKey: ["platform", "aiAliases", articleId] }) }); }
export function useDeleteDestAlias() { const qc = useQueryClient(); return useMutation({ mutationFn: async ({ id, articleId }: { id: string; articleId: string }) => { const { error } = await sb().from("knowledge_aliases").delete().eq("id", id); if (error) throw error; return articleId; }, onSuccess: (articleId) => qc.invalidateQueries({ queryKey: ["platform", "aiAliases", articleId] }) }); }
