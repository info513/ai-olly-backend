"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const sb = () => getSupabaseBrowserClient();

export type SearchResultKind = "room" | "guest" | "stay" | "request" | "consent" | "feedback";

export interface SearchResult {
  id: string;
  kind: SearchResultKind;
  title: string;
  subtitle?: string;
  href: string;
}

const esc = (s: string) => s.replace(/[%,()]/g, " ").trim();

/**
 * Real hotel-scoped search across operational records. Every query runs under the
 * caller's JWT so RLS decides visibility — e.g. an editor's guest query returns
 * nothing (no PII leak). Never returns tokens/UUIDs as user-facing text.
 */
export function useReceptionSearch(query: string, hotelId?: string, enabled = true) {
  const q = esc(query);
  return useQuery({
    queryKey: ["reception", "search", hotelId, q],
    enabled: enabled && !!hotelId && q.length >= 1,
    queryFn: async (): Promise<SearchResult[]> => {
      const like = `%${q}%`;
      const [rooms, guests, requests, feedback] = await Promise.all([
        sb().from("rooms").select("id,room_number").eq("hotel_id", hotelId).ilike("room_number", like).limit(5),
        sb().from("guests").select("id,first_name,last_name,pseudonymized_at").eq("hotel_id", hotelId).or(`first_name.ilike.${like},last_name.ilike.${like}`).limit(6),
        sb().from("guest_requests").select("id,title,status, room:rooms(room_number)").eq("hotel_id", hotelId).ilike("title", like).limit(6),
        sb().from("feedback").select("id,category,rating").eq("hotel_id", hotelId).ilike("category", like).limit(4),
      ]);

      const out: SearchResult[] = [];
      for (const r of rooms.data ?? []) out.push({ id: r.id, kind: "room", title: `Room ${r.room_number}`, subtitle: "Room", href: `/reception/today` });
      for (const g of (guests.data ?? []) as any[]) {
        const name = g.pseudonymized_at ? "Former guest" : [g.first_name, g.last_name].filter(Boolean).join(" ") || "Guest";
        out.push({ id: g.id, kind: "guest", title: name, subtitle: "Guest", href: `/guests/${g.id}` });
      }
      for (const rq of (requests.data ?? []) as any[]) out.push({ id: rq.id, kind: "request", title: rq.title, subtitle: `Request · ${rq.status}${rq.room?.room_number ? ` · Room ${rq.room.room_number}` : ""}`, href: `/reception/requests/${rq.id}` });
      for (const f of (feedback.data ?? []) as any[]) out.push({ id: f.id, kind: "feedback", title: f.category || "Feedback", subtitle: `Feedback${f.rating ? ` · ${f.rating}★` : ""}`, href: `/reception/feedback` });
      return out;
    },
  });
}
