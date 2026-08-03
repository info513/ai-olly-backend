"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const sb = () => getSupabaseBrowserClient();

// ── Date ranges ───────────────────────────────────────────────────────────────
export type RangePreset = "today" | "7d" | "30d" | "custom";
export interface DateRange { from: string; to: string; label: string; days: number }

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

export function makeRange(preset: RangePreset, custom?: { from: string; to: string }): DateRange {
  const today = ymd(new Date());
  if (preset === "today") return { from: today, to: today, label: "Today", days: 1 };
  if (preset === "7d") return { from: addDays(today, -6), to: today, label: "Last 7 days", days: 7 };
  if (preset === "30d") return { from: addDays(today, -29), to: today, label: "Last 30 days", days: 30 };
  const from = custom?.from ?? addDays(today, -29), to = custom?.to ?? today;
  const days = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 864e5) + 1);
  return { from, to, label: "Custom", days };
}
/** Previous equivalent period immediately before `r`. */
export function priorRange(r: DateRange): DateRange {
  const to = addDays(r.from, -1), from = addDays(to, -(r.days - 1));
  return { from, to, label: "Previous period", days: r.days };
}

export type DailyTable = "ai_quality_daily" | "operations_daily" | "newsletter_daily" | "content_health_daily";

/** Generic daily-rows read for a hotel over [from,to] (RLS gates by role). */
function useDaily<T = any>(table: DailyTable, hotelId?: string, r?: DateRange) {
  return useQuery({
    queryKey: ["analytics", table, hotelId, r?.from, r?.to],
    enabled: !!hotelId && !!r,
    queryFn: async (): Promise<T[]> => {
      const { data, error } = await sb().from(table).select("*").eq("hotel_id", hotelId).gte("day", r!.from).lte("day", r!.to).order("day");
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });
}

// ── AI analytics ──────────────────────────────────────────────────────────────
export interface AiRow { day: string; total_questions: number; deterministic_answers: number; model_answers: number; safe_handoffs: number; unanswered: number; avg_latency_ms: number | null; prompt_tokens: number; completion_tokens: number; knowledge_articles_used: number; coverage_estimate: number | null; calc_version: string }
export const useAiDaily = (h?: string, r?: DateRange) => useDaily<AiRow>("ai_quality_daily", h, r);

export function sumAi(rows: AiRow[]) {
  const s = { total: 0, det: 0, model: 0, handoff: 0, unanswered: 0, prompt: 0, completion: 0 };
  let latW = 0, latN = 0, artMax = 0;
  for (const x of rows) { s.total += x.total_questions; s.det += x.deterministic_answers; s.model += x.model_answers; s.handoff += x.safe_handoffs; s.unanswered += x.unanswered; s.prompt += Number(x.prompt_tokens); s.completion += Number(x.completion_tokens); if (x.avg_latency_ms != null) { latW += x.avg_latency_ms * x.total_questions; latN += x.total_questions; } artMax = Math.max(artMax, x.knowledge_articles_used); }
  return { ...s, avgLatency: latN ? Math.round(latW / latN) : null, articlesUsed: artMax };
}

// ── Operations analytics ──────────────────────────────────────────────────────
export interface OpsRow { day: string; requests_total: number; requests_resolved: number; requests_open: number; avg_ack_seconds: number | null; avg_resolution_seconds: number | null; feedback_count: number; avg_rating: number | null; stays_arriving: number; consents_granted: number; calc_version: string }
export const useOpsDaily = (h?: string, r?: DateRange) => useDaily<OpsRow>("operations_daily", h, r);

export function sumOps(rows: OpsRow[]) {
  const s = { total: 0, resolved: 0, open: 0, feedback: 0, arriving: 0, consents: 0 };
  let ackW = 0, ackN = 0, resW = 0, resN = 0, ratW = 0, ratN = 0;
  for (const x of rows) { s.total += x.requests_total; s.resolved += x.requests_resolved; s.open += x.requests_open; s.feedback += x.feedback_count; s.arriving += x.stays_arriving; s.consents += x.consents_granted;
    if (x.avg_ack_seconds != null) { ackW += x.avg_ack_seconds * x.requests_total; ackN += x.requests_total; }
    if (x.avg_resolution_seconds != null) { resW += x.avg_resolution_seconds * x.requests_resolved; resN += x.requests_resolved; }
    if (x.avg_rating != null) { ratW += x.avg_rating * x.feedback_count; ratN += x.feedback_count; } }
  return { ...s, avgAck: ackN ? Math.round(ackW / ackN) : null, avgResolution: resN ? Math.round(resW / resN) : null, avgRating: ratN ? ratW / ratN : null };
}

// ── Newsletter analytics ──────────────────────────────────────────────────────
export interface NlRow { day: string; subscribers_active: number; consent_active: number; sent: number; delivered: number; opened: number; clicked: number; bounced: number; unsubscribed: number; calc_version: string }
export const useNewsletterDailyAgg = (h?: string, r?: DateRange) => useDaily<NlRow>("newsletter_daily", h, r);

export function sumNl(rows: NlRow[]) {
  const s = { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0 };
  let subs = 0, consent = 0;
  for (const x of rows) { s.sent += x.sent; s.delivered += x.delivered; s.opened += x.opened; s.clicked += x.clicked; s.bounced += x.bounced; s.unsubscribed += x.unsubscribed; subs = x.subscribers_active; consent = x.consent_active; }
  return { ...s, subscribersActive: subs, consentActive: consent };
}

// ── Content-health analytics ──────────────────────────────────────────────────
export interface ContentRow { day: string; published_count: number; draft_count: number; archived_count: number; expired_count: number; critical_pending: number; unresolved_unanswered: number; unused_assets: number; assets_missing_alt: number; assets_missing_rights: number; completeness_score: number | null; calc_version: string }
export const useContentDaily = (h?: string, r?: DateRange) => useDaily<ContentRow>("content_health_daily", h, r);

// ── Helpers ───────────────────────────────────────────────────────────────────
export const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);
export const pctStr = (n: number, d: number) => { const v = pct(n, d); return v == null ? "—" : `${v}%`; };
export const deltaPct = (cur: number, prev: number): number | null => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
export const secs = (s: number | null) => (s == null ? "—" : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`);
export const latest = <T extends { day: string }>(rows: T[]): T | null => (rows.length ? rows[rows.length - 1] : null);

/** Whether every row shares one calc_version (for the "formula version" badge). */
export function calcVersion(rows: { calc_version?: string }[]): string | null {
  const set = new Set(rows.map((r) => r.calc_version).filter(Boolean));
  return set.size === 1 ? [...set][0]! : set.size === 0 ? null : "mixed";
}
