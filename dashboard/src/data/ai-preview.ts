"use client";

import { useMutation } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ResolvedKnowledge } from "./ai-types";

// Retrieval Preview is real: it uses useResolvedKnowledge(hotel, locale, preview)
// from ./knowledge.ts (LIVE vs PREVIEW). This module adds the AI ANSWER preview,
// which talks ONLY to the Dashboard's own server route — never the production
// guest API, and never with an OpenAI key in the browser bundle.

export interface AnswerPreviewRequest {
  hotelId: string;
  locale: string;
  question: string;
  mode: "live" | "preview";
}

export interface AnswerPreviewResult {
  mode: "live" | "preview";
  /** "retrieval" = deterministic approved-answer match (always safe, no paid call).
   *  "model" = server-side model call (only if explicitly enabled server-side).
   *  "insufficient" = supplied knowledge cannot answer. "deferred" = model path off. */
  kind: "retrieval" | "model" | "insufficient" | "deferred";
  answer: string | null;
  /** Article titles used to ground the answer (never IDs/UUIDs in UI). */
  sources: { title: string; source: string; approved: boolean }[];
  note: string | null;
}

export interface LocalRetrieval {
  answer: string | null;
  sources: AnswerPreviewResult["sources"];
  matched: ResolvedKnowledge | null;
}

/** Client-side deterministic answer: pick the best resolved article for the
 *  question from its approved answer. Mirrors the server contract so the UI can
 *  show a real Before/After even when the model path is deferred. */
export function localRetrievalAnswer(question: string, resolved: ResolvedKnowledge[]): LocalRetrieval {
  const q = question.toLowerCase();
  const tokens = q.split(/\W+/).filter((t) => t.length > 2);
  const score = (a: ResolvedKnowledge) => {
    const hay = `${a.title} ${a.key} ${a.approved_answer ?? ""}`.toLowerCase();
    let s = tokens.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
    if (a.is_critical) s += 0.25; // safety-relevant content ranked slightly higher
    return s;
  };
  const ranked = [...resolved].filter((a) => a.approved_answer).sort((a, b) => score(b) - score(a));
  const best = ranked[0] && score(ranked[0]) > 0 ? ranked[0] : null;
  return {
    answer: best?.approved_answer ?? null,
    sources: best ? [{ title: best.title, source: best.source, approved: true }] : [],
    matched: best,
  };
}

/** Calls the Dashboard's own server route. The route decides retrieval vs.
 *  model vs. deferred; the browser never holds a model key. */
export function useAnswerPreview() {
  return useMutation({
    mutationFn: async (req: AnswerPreviewRequest): Promise<AnswerPreviewResult> => {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again to test the AI.");
      const res = await fetch("/api/ai-preview", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `Preview failed (${res.status})`);
      }
      return (await res.json()) as AnswerPreviewResult;
    },
  });
}
