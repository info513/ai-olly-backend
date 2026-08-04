"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { RequestSummary, RequestDetail, RequestEvent, RequestStatus, RequestPriority } from "./reception-types";

const sb = () => getSupabaseBrowserClient();

export const rk = {
  requests: (h?: string) => ["reception", "requests", h] as const,
  request: (id?: string) => ["reception", "request", id] as const,
  events: (id?: string) => ["reception", "requestEvents", id] as const,
  today: (h?: string) => ["reception", "today", h] as const,
};

const OPEN_STATUSES: RequestStatus[] = ["new", "acknowledged", "in_progress"];
/** A request is overdue if still open past this age (hours), by priority. */
const OVERDUE_HOURS: Record<RequestPriority, number> = { urgent: 1, high: 4, normal: 24, low: 72 };

export function isRequestOverdue(r: { status: RequestStatus; priority: RequestPriority; createdAt: string }): boolean {
  if (!OPEN_STATUSES.includes(r.status)) return false;
  const ageH = (Date.now() - new Date(r.createdAt).getTime()) / 3.6e6;
  return ageH > OVERDUE_HOURS[r.priority];
}

const mapRequest = (r: any): RequestSummary => ({
  id: r.id, requestType: r.request_type, title: r.title, status: r.status, priority: r.priority,
  roomId: r.room_id, roomNumber: r.room?.room_number ?? null, stayId: r.stay_id, guestId: r.guest_id,
  assignedTo: r.assigned_to, createdAt: r.created_at, updatedAt: r.updated_at, acknowledgedAt: r.acknowledged_at, resolvedAt: r.resolved_at,
});

const LIST_SELECT = "id,request_type,title,status,priority,room_id,stay_id,guest_id,assigned_to,created_at,updated_at,acknowledged_at,resolved_at, room:rooms(room_number)";

export function useRequests(hotelId?: string) {
  return useQuery({
    queryKey: rk.requests(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<RequestSummary[]> => {
      const { data, error } = await sb().from("guest_requests").select(LIST_SELECT).eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []).map(mapRequest);
    },
  });
}

export function useRequest(id?: string) {
  return useQuery({
    queryKey: rk.request(id),
    enabled: !!id,
    queryFn: async (): Promise<RequestDetail> => {
      const { data, error } = await sb().from("guest_requests").select("*, room:rooms(room_number)").eq("id", id).single();
      if (error) throw error;
      const s = mapRequest(data);
      return { ...s, hotelId: (data as any).hotel_id, description: (data as any).description, guestVisibleResponse: (data as any).guest_visible_response, internalNotes: (data as any).internal_notes, closedAt: (data as any).closed_at, source: (data as any).source };
    },
  });
}

export function useRequestEvents(id?: string) {
  return useQuery({
    queryKey: rk.events(id),
    enabled: !!id,
    queryFn: async (): Promise<RequestEvent[]> => {
      const { data, error } = await sb().from("request_events").select("id,event_type,from_status,to_status,note,is_internal,actor_user_id,created_at").eq("request_id", id).order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((e: any): RequestEvent => ({
        id: e.id, eventType: e.event_type, fromStatus: e.from_status, toStatus: e.to_status, note: e.note,
        isInternal: e.is_internal, actorUserId: e.actor_user_id, createdAt: e.created_at,
      }));
    },
  });
}

export function useCreateRequest(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { title: string; requestType: string; description?: string | null; priority?: RequestPriority; stayId?: string | null; roomId?: string | null; guestId?: string | null }) => {
      const { data, error } = await sb().from("guest_requests").insert({
        hotel_id: hotelId, title: v.title, request_type: v.requestType, description: v.description ?? null,
        priority: v.priority ?? "normal", stay_id: v.stayId ?? null, room_id: v.roomId ?? null, guest_id: v.guestId ?? null, source: "dashboard",
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: rk.requests(hotelId) }),
  });
}

/** Lifecycle mutations. Status changes auto-append a request_event (DB trigger);
 *  notes/replies/assignment append an explicit event so the timeline is complete. */
export function useRequestActions(hotelId?: string) {
  const qc = useQueryClient();
  const invalidate = (id: string) => {
    qc.invalidateQueries({ queryKey: rk.requests(hotelId) });
    qc.invalidateQueries({ queryKey: rk.request(id) });
    qc.invalidateQueries({ queryKey: rk.events(id) });
    qc.invalidateQueries({ queryKey: rk.today(hotelId) });
  };

  const patch = async (id: string, row: Record<string, unknown>) => {
    const { error } = await sb().from("guest_requests").update(row).eq("id", id);
    if (error) throw error;
  };
  const event = async (id: string, e: { hotelId: string; eventType: RequestEvent["eventType"]; note?: string | null; isInternal?: boolean }) => {
    const { error } = await sb().from("request_events").insert({ request_id: id, hotel_id: e.hotelId, event_type: e.eventType, note: e.note ?? null, is_internal: e.isInternal ?? false });
    if (error) throw error;
  };

  return {
    setStatus: useMutation({
      mutationFn: async ({ id, status }: { id: string; status: RequestStatus }) => {
        const row: Record<string, unknown> = { status };
        if (status === "acknowledged") row.acknowledged_at = new Date().toISOString();
        if (status === "resolved") row.resolved_at = new Date().toISOString();
        if (status === "closed") row.closed_at = new Date().toISOString();
        await patch(id, row); return id;
      },
      onSuccess: invalidate,
    }),
    setPriority: useMutation({
      mutationFn: async ({ id, priority }: { id: string; priority: RequestPriority }) => { await patch(id, { priority }); return id; },
      onSuccess: invalidate,
    }),
    assign: useMutation({
      mutationFn: async ({ id, hotelId: h, assignee }: { id: string; hotelId: string; assignee: string | null }) => {
        await patch(id, { assigned_to: assignee });
        await event(id, { hotelId: h, eventType: "assigned", note: assignee ? "Assigned" : "Unassigned", isInternal: true });
        return id;
      },
      onSuccess: invalidate,
    }),
    addInternalNote: useMutation({
      mutationFn: async ({ id, hotelId: h, note }: { id: string; hotelId: string; note: string }) => {
        await event(id, { hotelId: h, eventType: "internal_note", note, isInternal: true });
        return id;
      },
      onSuccess: invalidate,
    }),
    addGuestReply: useMutation({
      mutationFn: async ({ id, hotelId: h, reply }: { id: string; hotelId: string; reply: string }) => {
        await patch(id, { guest_visible_response: reply });
        await event(id, { hotelId: h, eventType: "guest_reply", note: reply, isInternal: false });
        return id;
      },
      onSuccess: invalidate,
    }),
  };
}

// ── Reception Today aggregate (prioritized work, not analytics) ───────────────
export interface TodayData {
  arrivals: RequestSummaryLike[];
  departures: RequestSummaryLike[];
  activeStays: RequestSummaryLike[];
  newRequests: RequestSummary[];
  overdueRequests: RequestSummary[];
  consentMissing: RequestSummaryLike[];
  recentFeedback: { id: string; rating: number | null; category: string | null; followUp: boolean; createdAt: string }[];
  counts: { arrivals: number; departures: number; active: number; newReq: number; overdue: number; consentMissing: number };
}
export interface RequestSummaryLike {
  stayId: string; roomNumber: string | null; guestName: string | null; status: string;
  arrivalAt: string | null; departureAt: string | null; guestId: string | null; hasConsent: boolean;
}

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

/** Everything Reception needs at a glance, computed from real stays/requests/
 *  consents/feedback. "Today" is by the browser's local day (hotel tz refinement
 *  is a Sprint-6 note; dev data uses today's date). */
export function useReceptionToday(hotelId?: string) {
  return useQuery({
    queryKey: rk.today(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<TodayData> => {
      const today = ymd(new Date());
      const [staysR, reqR, consR, fbR] = await Promise.all([
        // Bounded (RC1 · H5): "today" only ever uses reserved/checked-in stays and
        // open requests — filter server-side (behavior-preserving) + cap.
        sb().from("stays").select("id,guest_id,room_id,status,arrival_at,departure_at, room:rooms(room_number), guest:guests(first_name,last_name,pseudonymized_at)").eq("hotel_id", hotelId).in("status", ["reserved", "checked_in"]).limit(2000),
        sb().from("guest_requests").select(LIST_SELECT).eq("hotel_id", hotelId).not("status", "in", "(resolved,closed,cancelled)").limit(1000),
        sb().from("consents").select("stay_id,guest_id,status").eq("hotel_id", hotelId).limit(2000),
        sb().from("feedback").select("id,rating,category,follow_up_requested,created_at").eq("hotel_id", hotelId).order("created_at", { ascending: false }).limit(5),
      ]);
      if (staysR.error) throw staysR.error;

      const grantedStay = new Set<string>();
      const grantedGuest = new Set<string>();
      for (const c of consR.data ?? []) { if (c.status === "granted") { if (c.stay_id) grantedStay.add(c.stay_id); if (c.guest_id) grantedGuest.add(c.guest_id); } }

      const gname = (g: any) => g?.pseudonymized_at ? "Former guest" : [g?.first_name, g?.last_name].filter(Boolean).join(" ") || null;
      const like = (s: any): RequestSummaryLike => ({
        stayId: s.id, roomNumber: s.room?.room_number ?? null, guestName: gname(s.guest), status: s.status,
        arrivalAt: s.arrival_at, departureAt: s.departure_at, guestId: s.guest_id,
        hasConsent: (s.id && grantedStay.has(s.id)) || (s.guest_id && grantedGuest.has(s.guest_id)) || false,
      });

      const stays = staysR.data ?? [];
      const arrivals = stays.filter((s: any) => s.status === "reserved" && s.arrival_at && String(s.arrival_at).slice(0, 10) === today).map(like);
      const departures = stays.filter((s: any) => s.status === "checked_in" && s.departure_at && String(s.departure_at).slice(0, 10) === today).map(like);
      const activeStays = stays.filter((s: any) => s.status === "checked_in").map(like);
      const consentMissing = activeStays.filter((s) => !s.hasConsent);

      const requests = (reqR.data ?? []).map(mapRequest);
      const newRequests = requests.filter((r) => r.status === "new");
      const overdueRequests = requests.filter((r) => isRequestOverdue(r));

      return {
        arrivals, departures, activeStays, newRequests, overdueRequests, consentMissing,
        recentFeedback: (fbR.data ?? []).map((f: any) => ({ id: f.id, rating: f.rating, category: f.category, followUp: f.follow_up_requested, createdAt: f.created_at })),
        counts: { arrivals: arrivals.length, departures: departures.length, active: activeStays.length, newReq: newRequests.length, overdue: overdueRequests.length, consentMissing: consentMissing.length },
      };
    },
  });
}

export function useGuestRequests(guestId?: string) {
  return useQuery({
    queryKey: ["reception", "guestRequests", guestId],
    enabled: !!guestId,
    queryFn: async (): Promise<RequestSummary[]> => {
      const { data, error } = await sb().from("guest_requests").select(LIST_SELECT).eq("guest_id", guestId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapRequest);
    },
  });
}

export function useStayRequests(stayId?: string) {
  return useQuery({
    queryKey: ["reception", "stayRequests", stayId],
    enabled: !!stayId,
    queryFn: async (): Promise<RequestSummary[]> => {
      const { data, error } = await sb().from("guest_requests").select(LIST_SELECT).eq("stay_id", stayId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapRequest);
    },
  });
}
