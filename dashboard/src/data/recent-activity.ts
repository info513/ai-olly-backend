"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const sb = () => getSupabaseBrowserClient();

export type ActivityKind = "content" | "knowledge" | "request" | "stay" | "consent" | "campaign" | "asset";
export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  text: string;      // human, redacted — never a UUID / email / token / path
  at: string;
  href?: string;
}

const REQ_LABEL: Record<string, string> = {
  created: "New guest request", acknowledged: "Request acknowledged", resolved: "Request resolved",
  status_change: "Request updated", guest_reply: "Reply sent to a guest", internal_note: "Internal note added",
  assigned: "Request assignment changed", reopened: "Request reopened",
};

/**
 * A safe, human recent-activity feed (Part 13). Derived from readable per-entity
 * tables (never audit_log, which is backend-only) and RLS-gated, so it naturally
 * adapts to the caller's role. Shows room numbers / titles / names — never UUIDs,
 * guest PII, tokens, private paths, signatures or raw payloads.
 */
export function useRecentActivity(hotelId?: string, limit = 25) {
  return useQuery({
    queryKey: ["recentActivity", hotelId],
    enabled: !!hotelId,
    queryFn: async (): Promise<ActivityItem[]> => {
      const [events, stays, consents, assets, camps, knowledge, services, templates] = await Promise.all([
        sb().from("request_events").select("id,event_type,is_internal,created_at,request_id").eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(12),
        sb().from("stays").select("id,checked_in_at,checked_out_at, room:rooms(room_number)").eq("hotel_id", hotelId).order("updated_at", { ascending: false }).limit(12),
        sb().from("consents").select("id,consent_type,status,signed_at,revoked_at,guest_id").eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(10),
        sb().from("assets").select("id,display_name,created_at,deleted_at").eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(10),
        sb().from("newsletter_campaigns").select("id,name,status,scheduled_at,sent_at,created_at").eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(8),
        sb().from("knowledge_articles").select("id,title,published_at").eq("hotel_id", hotelId).not("published_at", "is", null).order("published_at", { ascending: false }).limit(8),
        sb().from("hotel_services").select("id,title,published_at").eq("hotel_id", hotelId).not("published_at", "is", null).order("published_at", { ascending: false }).limit(8),
        sb().from("newsletter_templates").select("id,name,published_at").eq("hotel_id", hotelId).not("published_at", "is", null).order("published_at", { ascending: false }).limit(6),
      ]);

      const out: ActivityItem[] = [];
      for (const e of events.data ?? []) if (["created", "acknowledged", "resolved", "guest_reply"].includes(e.event_type)) out.push({ id: `ev-${e.id}`, kind: "request", text: REQ_LABEL[e.event_type] ?? "Request activity", at: e.created_at, href: `/reception/requests/${e.request_id}` });
      for (const s of (stays.data ?? []) as any[]) {
        const room = s.room?.room_number ? ` (Room ${s.room.room_number})` : "";
        if (s.checked_in_at) out.push({ id: `in-${s.id}`, kind: "stay", text: `Guest checked in${room}`, at: s.checked_in_at, href: `/stays/${s.id}` });
        if (s.checked_out_at) out.push({ id: `out-${s.id}`, kind: "stay", text: `Guest checked out${room}`, at: s.checked_out_at, href: `/stays/${s.id}` });
      }
      for (const c of (consents.data ?? []) as any[]) {
        if (c.status === "revoked" && c.revoked_at) out.push({ id: `cr-${c.id}`, kind: "consent", text: `Consent revoked (${c.consent_type})`, at: c.revoked_at, href: `/consent/${c.id}` });
        else if (c.signed_at) out.push({ id: `cs-${c.id}`, kind: "consent", text: `Consent signed (${c.consent_type})`, at: c.signed_at, href: `/consent/${c.id}` });
      }
      for (const a of (assets.data ?? []) as any[]) {
        if (a.deleted_at) out.push({ id: `aa-${a.id}`, kind: "asset", text: `Asset archived: ${a.display_name}`, at: a.deleted_at, href: `/assets/${a.id}` });
        else out.push({ id: `au-${a.id}`, kind: "asset", text: `Asset uploaded: ${a.display_name}`, at: a.created_at, href: `/assets/${a.id}` });
      }
      for (const c of (camps.data ?? []) as any[]) {
        if (c.status === "sent" && c.sent_at) out.push({ id: `cs-${c.id}`, kind: "campaign", text: `Campaign sent: ${c.name}`, at: c.sent_at, href: `/newsletter/campaigns/${c.id}` });
        else if (c.status === "scheduled" && c.scheduled_at) out.push({ id: `csc-${c.id}`, kind: "campaign", text: `Campaign scheduled: ${c.name}`, at: c.scheduled_at, href: `/newsletter/campaigns/${c.id}` });
      }
      for (const k of (knowledge.data ?? []) as any[]) out.push({ id: `kp-${k.id}`, kind: "knowledge", text: `Knowledge published: ${k.title}`, at: k.published_at, href: `/ai/knowledge/${k.id}` });
      for (const s of (services.data ?? []) as any[]) out.push({ id: `sp-${s.id}`, kind: "content", text: `Service published: ${s.title}`, at: s.published_at, href: `/content/services/${s.id}` });
      for (const t of (templates.data ?? []) as any[]) out.push({ id: `tp-${t.id}`, kind: "content", text: `Newsletter template published: ${t.name}`, at: t.published_at, href: `/newsletter/templates/${t.id}` });

      return out.filter((x) => x.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
    },
  });
}
