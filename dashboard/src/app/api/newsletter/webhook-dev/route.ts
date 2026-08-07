import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBrevoAdapter } from "@/server/integrations/brevo";
import { assertDevProject } from "@/server/dev-guard";

// ============================================================================
// DEV-ONLY synthetic webhook ingestion (Sprint 7, Part 15).
// ----------------------------------------------------------------------------
// A LOCAL ingestion contract for provider (Brevo) delivery events. It is NEVER
// exposed to or contacted by any external system in this sprint — it exists so
// the Dashboard/verify can exercise idempotent append-only ingestion with
// synthetic events. It:
//   • requires a real JWT and hotel_admin/marketing (or platform_admin) for the
//     campaign's hotel,
//   • records the webhook event IDEMPOTENTLY (unique provider_event_id) with a
//     redacted payload (no PII/secrets),
//   • appends an immutable newsletter_events row.
// No email is sent; the Brevo adapter stays "not configured".
// ============================================================================

export const runtime = "nodejs";
const VALID: string[] = ["sent", "delivered", "opened", "clicked", "bounced", "unsubscribed", "complained", "deferred"];

export async function POST(req: Request) {
  // DEV-ONLY guard (S-09): reject in production / non-aiolly-dev BEFORE any
  // service-role side effect. No email is ever sent regardless.
  try { assertDevProject(); }
  catch (e: any) { return NextResponse.json({ error: e?.message ?? "DEV-only endpoint." }, { status: e?.status ?? 403 }); }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return NextResponse.json({ error: "Server not configured." }, { status: 500 });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!token) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: { campaignId?: string; providerEventId?: string; eventType?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const { campaignId, providerEventId, eventType } = body;
  if (!campaignId || !providerEventId || !eventType) return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  if (!VALID.includes(eventType)) return NextResponse.json({ error: "Unsupported event type." }, { status: 400 });

  const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: user } = await caller.auth.getUser();
  if (!user?.user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { data: camp } = await caller.from("newsletter_campaigns").select("id,hotel_id").eq("id", campaignId).maybeSingle();
  if (!camp) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const { data: prof } = await caller.from("profiles").select("is_platform_admin").eq("user_id", user.user.id).maybeSingle();
  if (!prof?.is_platform_admin) {
    const { data: mem } = await caller.from("hotel_memberships").select("role").eq("hotel_id", camp.hotel_id).eq("status", "active").maybeSingle();
    if (!mem || !["hotel_admin", "marketing"].includes(mem.role)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  // The adapter stays "not configured" — this route only ingests, it never sends.
  const brevo = getBrevoAdapter();
  const processed = await brevo.processWebhook({ rawEventId: providerEventId, eventType, payload: { event: eventType } });

  const svc = createClient(url, service, { auth: { persistSession: false } });
  // idempotent by (provider, provider_event_id)
  const existing = await svc.from("newsletter_webhook_events").select("id").eq("provider", "brevo").eq("provider_event_id", providerEventId).maybeSingle();
  if (existing.data) return NextResponse.json({ ingested: false, duplicate: true, adapter: processed.reason ?? "ok" });

  const ins = await svc.from("newsletter_webhook_events").insert({ hotel_id: camp.hotel_id, provider: "brevo", provider_event_id: providerEventId, event_type: eventType, payload: { event: eventType }, processed_at: new Date().toISOString() });
  if (ins.error) {
    if (/duplicate key|unique/i.test(ins.error.message)) return NextResponse.json({ ingested: false, duplicate: true });
    return NextResponse.json({ error: "Ingestion failed." }, { status: 500 });
  }
  await svc.from("newsletter_events").insert({ hotel_id: camp.hotel_id, campaign_id: campaignId, event_type: eventType, metadata: { source: "dev-webhook" } });

  return NextResponse.json({ ingested: true, duplicate: false, adapter: processed.reason ?? "ok" });
}
