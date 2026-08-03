import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { redactWebhookPayload } from "@/server/integrations/brevo";

// ============================================================================
// Newsletter provider (webhook) events — redacted admin visibility (Sprint 7).
// ----------------------------------------------------------------------------
// newsletter_webhook_events has NO authenticated grant (backend-only). This route
// reads it with the service-role key (server env only) but authorizes with the
// CALLER'S JWT: the caller must be able to see the campaign (RLS) before we return
// anything, and we only ever return a short REDACTED summary — never the raw JSON
// payload, never an email or provider secret.
// ============================================================================

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return NextResponse.json({ error: "Server not configured." }, { status: 500 });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!token) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const campaignId = new URL(req.url).searchParams.get("campaignId");
  if (!campaignId) return NextResponse.json({ error: "Missing campaign." }, { status: 400 });

  const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: user } = await caller.auth.getUser();
  if (!user?.user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  // authorize: the caller must be able to see the campaign (RLS)
  const { data: camp } = await caller.from("newsletter_campaigns").select("id,hotel_id").eq("id", campaignId).maybeSingle();
  if (!camp) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const svc = createClient(url, service, { auth: { persistSession: false } });
  const { data, error } = await svc.from("newsletter_webhook_events").select("id,provider,provider_event_id,event_type,processed_at,created_at,payload").eq("hotel_id", camp.hotel_id).order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "Could not load events." }, { status: 500 });

  const events = (data ?? []).map((e: any) => ({
    id: e.id, provider: e.provider, providerEventId: e.provider_event_id, eventType: e.event_type,
    processedAt: e.processed_at, createdAt: e.created_at, summary: redactWebhookPayload(e.event_type, e.payload),
  }));
  return NextResponse.json({ events });
}
