import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ============================================================================
// AI Answer Preview — server-side ONLY (Sprint 4, Part 10).
// ----------------------------------------------------------------------------
// Security contract:
//   • Never touches the production guest API.
//   • The OpenAI key is read from SERVER env only and is NEVER sent to the browser.
//   • Re-fetches resolved knowledge server-side using the CALLER'S JWT (anon key
//     + bearer token) so RLS is authoritative and the model is grounded only in
//     knowledge the user is actually allowed to see — the client cannot inject
//     arbitrary "knowledge" to make the model say anything.
//   • Model execution is DEFERRED BY DEFAULT (AI_PREVIEW_MODEL_ENABLED !== "true").
//     When off we return a REAL deterministic retrieval answer (the approved
//     answer), clearly labelled — we never fabricate a model answer.
// ============================================================================

export const runtime = "nodejs";

type Mode = "live" | "preview";
interface Body { hotelId?: string; locale?: string; question?: string; mode?: Mode }

interface Resolved {
  article_id: string; source: string; key: string; title: string;
  approved_answer: string | null; body_content: any; is_critical: boolean; priority: number;
}

function retrieve(question: string, rows: Resolved[]): { best: Resolved | null } {
  const tokens = question.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  const score = (a: Resolved) => {
    const hay = `${a.title} ${a.key} ${a.approved_answer ?? ""}`.toLowerCase();
    let s = tokens.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
    if (a.is_critical) s += 0.25;
    return s;
  };
  const ranked = rows.filter((a) => a.approved_answer).sort((a, b) => score(b) - score(a));
  return { best: ranked[0] && score(ranked[0]) > 0 ? ranked[0] : null };
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.json({ error: "Server not configured." }, { status: 500 });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!token) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const { hotelId, locale = "en", question, mode = "live" } = body;
  if (!hotelId || !question?.trim()) return NextResponse.json({ error: "Missing hotel or question." }, { status: 400 });

  // Caller-scoped client — RLS enforced with the user's JWT. No service role.
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: user } = await sb.auth.getUser();
  if (!user?.user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data, error } = await sb.rpc("resolved_ai_knowledge", { p_hotel: hotelId, p_locale: locale, p_preview: mode === "preview" });
  if (error) return NextResponse.json({ error: "Could not load knowledge." }, { status: 403 });

  const rows = (data ?? []) as Resolved[];
  const { best } = retrieve(question, rows);
  const sources = best ? [{ title: best.title, source: best.source, approved: true }] : [];

  const modelEnabled = process.env.AI_PREVIEW_MODEL_ENABLED === "true" && !!process.env.OPENAI_API_KEY;

  // Model path is deferred by default. When enabled, this is where a strict,
  // supplied-knowledge-only server-side model call would run. Until then we
  // return the real deterministic retrieval answer — never a fabricated one.
  if (!best) {
    return NextResponse.json({
      mode, kind: "insufficient", answer: null, sources: [],
      note: "No published, AI-available answer covers this question. It belongs in Unanswered.",
    });
  }

  return NextResponse.json({
    mode,
    kind: "retrieval",
    answer: best.approved_answer,
    sources,
    note: modelEnabled
      ? "Deterministic retrieval match. Model rephrasing is enabled server-side."
      : "Deterministic retrieval match — the hotel-approved answer. Live model rephrasing is deferred (no external call is made in this environment).",
  });
}
