"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isRequestOverdue } from "./reception";

const sb = () => getSupabaseBrowserClient();

export type NotifTier = "critical" | "warning" | "task" | "info" | "success";

export interface OpNotification {
  id: string;
  tier: NotifTier;
  title: string;
  body: string;
  href: string;
  createdAt: string;
}

/**
 * A DERIVED, unified attention feed (Part 17) — not a separate source of truth.
 * Reads the same operational + content/AI/asset tables the pages use and surfaces
 * what needs action, tiered critical → warning → info. Every source is RLS-scoped,
 * so the feed adapts to the caller's role (empty slices for inaccessible sources).
 * No push sending. Never exposes PII/UUIDs/tokens.
 */
export function useOpNotifications(hotelId?: string) {
  return useQuery({
    queryKey: ["reception", "opnotifications", hotelId],
    enabled: !!hotelId,
    queryFn: async (): Promise<OpNotification[]> => {
      const today = new Date().toISOString().slice(0, 10);
      const [reqR, staysR, consR, fbR, kR, uR, aR] = await Promise.all([
        sb().from("guest_requests").select("id,title,status,priority,created_at, room:rooms(room_number)").eq("hotel_id", hotelId).in("status", ["new", "acknowledged", "in_progress"]),
        sb().from("stays").select("id,status,arrival_at, room:rooms(room_number)").eq("hotel_id", hotelId),
        sb().from("consents").select("stay_id,status").eq("hotel_id", hotelId),
        sb().from("feedback").select("id,category,follow_up_requested,status,created_at").eq("hotel_id", hotelId).eq("follow_up_requested", true).neq("status", "resolved"),
        sb().from("knowledge_articles").select("id,title,is_critical,status,valid_to,updated_at").eq("hotel_id", hotelId).eq("is_critical", true),
        sb().from("unanswered_questions").select("id,normalized_question,occurrence_count,last_seen_at").eq("hotel_id", hotelId).eq("status", "open").order("occurrence_count", { ascending: false }).limit(3),
        sb().from("assets").select("id,display_name,rights_owner,asset_type,deleted_at,created_at").eq("hotel_id", hotelId).is("deleted_at", null).is("rights_owner", null).limit(3),
      ]);

      const out: OpNotification[] = [];
      const requests = reqR.data ?? [];
      for (const r of requests as any[]) {
        if (r.priority === "urgent" || r.priority === "high") out.push({ id: `req-hi-${r.id}`, tier: r.priority === "urgent" ? "critical" : "warning", title: `${r.priority === "urgent" ? "Urgent" : "High-priority"} request`, body: `${r.title}${r.room?.room_number ? ` · Room ${r.room.room_number}` : ""}`, href: `/reception/requests/${r.id}`, createdAt: r.created_at });
        else if (r.status === "new") out.push({ id: `req-new-${r.id}`, tier: "task", title: "New request", body: r.title, href: `/reception/requests/${r.id}`, createdAt: r.created_at });
        if (isRequestOverdue({ status: r.status, priority: r.priority, createdAt: r.created_at })) out.push({ id: `req-od-${r.id}`, tier: "warning", title: "Overdue request", body: r.title, href: `/reception/requests/${r.id}`, createdAt: r.created_at });
      }

      const grantedStay = new Set<string>();
      for (const c of consR.data ?? []) if (c.status === "granted" && c.stay_id) grantedStay.add(c.stay_id);
      for (const s of (staysR.data ?? []) as any[]) {
        if (s.status === "checked_in" && !grantedStay.has(s.id)) out.push({ id: `cons-${s.id}`, tier: "warning", title: "Consent missing", body: `In-house stay${s.room?.room_number ? ` · Room ${s.room.room_number}` : ""} has no signed consent`, href: `/consent/capture/${s.id}`, createdAt: s.arrival_at ?? today });
        if (s.status === "reserved" && s.arrival_at && String(s.arrival_at).slice(0, 10) === today) out.push({ id: `arr-${s.id}`, tier: "info", title: "Arriving today", body: `Room ${s.room?.room_number ?? "—"}`, href: `/reception/today`, createdAt: s.arrival_at });
      }
      for (const f of (fbR.data ?? []) as any[]) out.push({ id: `fb-${f.id}`, tier: "task", title: "Feedback follow-up", body: f.category || "Guest requested follow-up", href: `/reception/feedback`, createdAt: f.created_at });

      // Content / AI / asset health (RLS-gated; empty for reception/marketing)
      const now = Date.now();
      for (const k of (kR.data ?? []) as any[]) {
        if (k.status === "published" && k.valid_to && new Date(k.valid_to).getTime() < now) out.push({ id: `kex-${k.id}`, tier: "critical", title: "Expired critical knowledge", body: k.title, href: `/ai/knowledge/${k.id}`, createdAt: k.updated_at ?? today });
        else if (k.status !== "published") out.push({ id: `kdr-${k.id}`, tier: "warning", title: "Critical change not published", body: k.title, href: `/ai/knowledge/${k.id}`, createdAt: k.updated_at ?? today });
      }
      for (const u of (uR.data ?? []) as any[]) out.push({ id: `un-${u.id}`, tier: "warning", title: "Unresolved question", body: `${u.normalized_question} · asked ${u.occurrence_count}×`, href: `/ai/unanswered`, createdAt: u.last_seen_at ?? today });
      for (const a of (aR.data ?? []) as any[]) out.push({ id: `ar-${a.id}`, tier: "warning", title: "Asset missing rights", body: a.display_name, href: `/assets/${a.id}`, createdAt: a.created_at ?? today });

      return out.sort((a, b) => {
        const order: Record<NotifTier, number> = { critical: 0, warning: 1, task: 2, info: 3, success: 4 };
        return order[a.tier] - order[b.tier] || String(b.createdAt).localeCompare(String(a.createdAt));
      }).slice(0, 20);
    },
  });
}
