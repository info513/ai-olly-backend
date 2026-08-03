"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const sb = () => getSupabaseBrowserClient();
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export interface HomeAi {
  questions7d: number;
  handoffRatePct: number | null;
  coveragePct: number | null;
  unanswered: number;               // open unanswered questions (live)
  expiredCritical: number;          // critical published knowledge past validity (live)
  criticalDrafts: number;           // critical knowledge not yet published (live)
  missingApprovedAnswer: number;    // AI-available knowledge without an approved answer (live)
  spark: number[];                  // daily questions, last 7d
  hasDaily: boolean;                // whether the role can read ai_quality_daily
}

/** Home AI slice: 7d questions/handoff/coverage from ai_quality_daily (RLS-gated;
 *  empty for roles without access) + live knowledge-critical counts. */
export function useHomeAi(hotelId?: string) {
  return useQuery({
    queryKey: ["home", "ai", hotelId],
    enabled: !!hotelId,
    queryFn: async (): Promise<HomeAi> => {
      const from = ymd(new Date(Date.now() - 6 * 864e5));
      const [dailyR, kR, uR] = await Promise.all([
        sb().from("ai_quality_daily").select("day,total_questions,safe_handoffs,coverage_estimate").eq("hotel_id", hotelId).gte("day", from).order("day"),
        sb().from("knowledge_articles").select("is_critical,status,valid_to,available_to_ai,approved_answer").or(`hotel_id.eq.${hotelId},hotel_id.is.null`),
        sb().from("unanswered_questions").select("id", { count: "exact", head: true }).eq("hotel_id", hotelId).eq("status", "open"),
      ]);
      const daily = dailyR.data ?? [];
      const q7 = daily.reduce((a, x) => a + x.total_questions, 0);
      const h7 = daily.reduce((a, x) => a + x.safe_handoffs, 0);
      const cov = daily.length ? daily[daily.length - 1].coverage_estimate : null;
      const now = Date.now();
      const arts = kR.data ?? [];
      return {
        questions7d: q7,
        handoffRatePct: q7 > 0 ? Math.round((h7 / q7) * 100) : null,
        coveragePct: cov != null ? Math.round(Number(cov) * 100) : null,
        unanswered: uR.count ?? 0,
        expiredCritical: arts.filter((a: any) => a.is_critical && a.status === "published" && a.valid_to && new Date(a.valid_to).getTime() < now).length,
        criticalDrafts: arts.filter((a: any) => a.is_critical && a.status !== "published").length,
        missingApprovedAnswer: arts.filter((a: any) => a.available_to_ai && !a.approved_answer).length,
        spark: daily.map((x) => x.total_questions),
        hasDaily: daily.length > 0,
      };
    },
  });
}

export interface HomeContent {
  knowledgeDrafts: number;
  knowledgeExpired: number;
  serviceDrafts: number;
  serviceExpired: number;
  servicesNotAvailableToAi: number;
}

/** Home content-warning slice — live counts from knowledge + services (readable
 *  by hotel members; RLS returns nothing for non-members). */
export function useHomeContent(hotelId?: string) {
  return useQuery({
    queryKey: ["home", "content", hotelId],
    enabled: !!hotelId,
    queryFn: async (): Promise<HomeContent> => {
      const now = Date.now();
      const [kR, sR] = await Promise.all([
        sb().from("knowledge_articles").select("status,valid_to").eq("hotel_id", hotelId),
        sb().from("hotel_services").select("status,valid_to,available_to_ai").eq("hotel_id", hotelId),
      ]);
      const k = kR.data ?? [], s = sR.data ?? [];
      const expired = (rows: any[]) => rows.filter((x) => x.status === "published" && x.valid_to && new Date(x.valid_to).getTime() < now).length;
      return {
        knowledgeDrafts: k.filter((x: any) => x.status === "draft").length,
        knowledgeExpired: expired(k),
        serviceDrafts: s.filter((x: any) => x.status === "draft").length,
        serviceExpired: expired(s),
        servicesNotAvailableToAi: s.filter((x: any) => x.status === "published" && !x.available_to_ai).length,
      };
    },
  });
}
