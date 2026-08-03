"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AiQualityDaily, KnowledgeArticle, ResolvedKnowledge, UnansweredQuestion } from "./ai-types";

const sb = () => getSupabaseBrowserClient();

export const qqk = {
  daily: (h?: string) => ["ai", "qualityDaily", h] as const,
};

/** Raw daily aggregates (ai_quality_daily). Empty in fresh dev data — the UI
 *  shows an explicit empty state rather than an invented score. */
export function useQualityDaily(hotelId?: string, days = 30) {
  return useQuery({
    queryKey: qqk.daily(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<AiQualityDaily[]> => {
      const { data, error } = await sb()
        .from("ai_quality_daily")
        .select("*")
        .eq("hotel_id", hotelId)
        .order("day", { ascending: false })
        .limit(days);
      if (error) throw error;
      return (data ?? []) as AiQualityDaily[];
    },
  });
}

// ── Documented metrics ────────────────────────────────────────────────────────
// Every score carries the exact formula it was computed from; no opaque numbers.
export interface QualityMetric {
  key: string;
  label: string;
  value: number | null; // null → not enough data
  unit: "percent" | "count" | "ms";
  formula: string;
  window: string;
}

export function computeQualityMetrics(rows: AiQualityDaily[]): QualityMetric[] {
  const sum = (f: (r: AiQualityDaily) => number | null) =>
    rows.reduce((acc, r) => acc + (f(r) ?? 0), 0);
  const total = sum((r) => r.total_questions);
  const det = sum((r) => r.deterministic_answers);
  const model = sum((r) => r.model_answers);
  const handoff = sum((r) => r.safe_handoffs);
  const unans = sum((r) => r.unanswered);
  const answered = det + model;
  const latencyRows = rows.filter((r) => r.avg_latency_ms != null && r.total_questions > 0);
  const latWeighted = latencyRows.reduce((a, r) => a + (r.avg_latency_ms ?? 0) * r.total_questions, 0);
  const latQ = latencyRows.reduce((a, r) => a + r.total_questions, 0);
  const win = rows.length ? `last ${rows.length} day(s) of ai_quality_daily` : "no data yet";

  return [
    {
      key: "answer_rate", label: "Answer rate", unit: "percent",
      value: total ? (answered / total) * 100 : null,
      formula: "(deterministic_answers + model_answers) ÷ total_questions",
      window: win,
    },
    {
      key: "deterministic_share", label: "Deterministic share", unit: "percent",
      value: answered ? (det / answered) * 100 : null,
      formula: "deterministic_answers ÷ (deterministic_answers + model_answers)",
      window: win,
    },
    {
      key: "handoff_rate", label: "Safe handoff rate", unit: "percent",
      value: total ? (handoff / total) * 100 : null,
      formula: "safe_handoffs ÷ total_questions",
      window: win,
    },
    {
      key: "unanswered_rate", label: "Unanswered rate", unit: "percent",
      value: total ? (unans / total) * 100 : null,
      formula: "unanswered ÷ total_questions",
      window: win,
    },
    {
      key: "avg_latency", label: "Avg latency", unit: "ms",
      value: latQ ? latWeighted / latQ : null,
      formula: "Σ(avg_latency_ms × total_questions) ÷ Σ(total_questions)",
      window: win,
    },
  ];
}

/** Live knowledge-coverage estimate, computed transparently from resolved
 *  knowledge vs. unresolved unanswered questions. Not a black box. */
export interface CoverageMetric {
  value: number | null;
  formula: string;
  resolvedCount: number;
  openUnanswered: number;
}
export function computeCoverage(resolved: ResolvedKnowledge[], unanswered: UnansweredQuestion[]): CoverageMetric {
  const resolvedCount = resolved.length;
  const openUnanswered = unanswered.filter((u) => u.status === "open").length;
  const denom = resolvedCount + openUnanswered;
  return {
    value: denom ? (resolvedCount / denom) * 100 : null,
    formula: "live_resolved_articles ÷ (live_resolved_articles + open_unanswered_questions)",
    resolvedCount, openUnanswered,
  };
}

/** Content-health signals derived from the article list (all documented). */
export function computeKnowledgeHealth(articles: KnowledgeArticle[], unanswered: UnansweredQuestion[]) {
  const now = Date.now();
  const expired = (a: KnowledgeArticle) => a.valid_to != null && new Date(a.valid_to).getTime() < now;
  return {
    publishedCount: articles.filter((a) => a.status === "published").length,
    draftCount: articles.filter((a) => a.status === "draft").length,
    expiredCritical: articles.filter((a) => a.is_critical && expired(a)).length,
    criticalPending: articles.filter((a) => a.is_critical && a.status !== "published").length,
    missingApprovedAnswer: articles.filter((a) => a.available_to_ai && !a.approved_answer).length,
    unresolvedUnanswered: unanswered.filter((u) => u.status === "open").length,
  };
}
