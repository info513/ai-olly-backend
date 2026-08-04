"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { GuestSummary, GuestProfile, DuplicateSuggestion, StayStatus } from "./reception-types";

const sb = () => getSupabaseBrowserClient();

export const gk = {
  guests: (h?: string) => ["reception", "guests", h] as const,
  guest: (id?: string) => ["reception", "guest", id] as const,
  duplicates: (h?: string) => ["reception", "duplicates", h] as const,
};

const fullName = (first: string | null, last: string | null, pseudonymized: boolean) =>
  pseudonymized ? "Former guest" : [first, last].filter(Boolean).join(" ") || "Guest";

/** Guest list with latest-stay context, open-request counts and consent status
 *  stitched centrally (RLS returns only guests the caller may see). */
export function useGuests(hotelId?: string) {
  return useQuery({
    queryKey: gk.guests(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<GuestSummary[]> => {
      // Bounded fetches (RC1 · H5): cap the list + its aggregation satellites so a
      // large property's history can't be pulled wholesale into the browser.
      const [guestsR, staysR, reqR, consR] = await Promise.all([
        sb().from("guests").select("id,first_name,last_name,preferred_locale,country_code,pseudonymized_at,deleted_at").eq("hotel_id", hotelId).order("updated_at", { ascending: false }).limit(1000),
        sb().from("stays").select("id,guest_id,room_id,status,arrival_at,departure_at, room:rooms(room_number)").eq("hotel_id", hotelId).limit(2000),
        sb().from("guest_requests").select("guest_id,status").eq("hotel_id", hotelId).not("status", "in", "(resolved,closed,cancelled)").limit(2000),
        sb().from("consents").select("guest_id,status").eq("hotel_id", hotelId).limit(2000),
      ]);
      if (guestsR.error) throw guestsR.error;
      const stays = staysR.data ?? [];
      const openByGuest = new Map<string, number>();
      for (const r of reqR.data ?? []) if (r.guest_id) openByGuest.set(r.guest_id, (openByGuest.get(r.guest_id) ?? 0) + 1);
      const consentByGuest = new Map<string, boolean>();
      for (const c of consR.data ?? []) if (c.guest_id && c.status === "granted") consentByGuest.set(c.guest_id, true);

      // Bucket stays by guest once (O(N+M)) instead of filtering all stays per guest (O(N·M)).
      const rank: Record<string, number> = { checked_in: 4, reserved: 3, checked_out: 2, no_show: 1, cancelled: 0 };
      const staysByGuest = new Map<string, any[]>();
      for (const s of stays as any[]) { if (!s.guest_id) continue; const a = staysByGuest.get(s.guest_id); if (a) a.push(s); else staysByGuest.set(s.guest_id, [s]); }
      const latestStay = (gid: string) =>
        (staysByGuest.get(gid) ?? [])
          .slice()
          .sort((a: any, b: any) => (rank[b.status] - rank[a.status]) || String(b.arrival_at ?? "").localeCompare(String(a.arrival_at ?? "")))[0];

      return (guestsR.data ?? []).map((g: any): GuestSummary => {
        const pseudonymized = !!g.pseudonymized_at;
        const s = latestStay(g.id) as any;
        return {
          id: g.id,
          displayName: fullName(g.first_name, g.last_name, pseudonymized),
          preferredLocale: g.preferred_locale, countryCode: g.country_code,
          pseudonymized, deleted: !!g.deleted_at,
          latestStayId: s?.id ?? null, roomNumber: s?.room?.room_number ?? null,
          stayStatus: (s?.status ?? null) as StayStatus | null,
          arrivalAt: s?.arrival_at ?? null, departureAt: s?.departure_at ?? null,
          openRequests: openByGuest.get(g.id) ?? 0, hasConsent: consentByGuest.get(g.id) ?? false,
        };
      });
    },
  });
}

export function useGuest(id?: string) {
  return useQuery({
    queryKey: gk.guest(id),
    enabled: !!id,
    queryFn: async (): Promise<GuestProfile> => {
      const { data, error } = await sb().from("guests").select("*").eq("id", id).single();
      if (error) throw error;
      const pseudonymized = !!data.pseudonymized_at;
      return {
        id: data.id, displayName: fullName(data.first_name, data.last_name, pseudonymized),
        firstName: data.first_name, lastName: data.last_name, email: data.email, phone: data.phone,
        preferredLocale: data.preferred_locale, countryCode: data.country_code,
        externalSource: data.external_source, externalId: data.external_id,
        pseudonymized, pseudonymizedAt: data.pseudonymized_at, deleted: !!data.deleted_at,
        createdAt: data.created_at,
      };
    },
  });
}

export function useCreateGuest(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<GuestProfile>) => {
      const { data, error } = await sb().from("guests").insert({
        hotel_id: hotelId, first_name: values.firstName ?? null, last_name: values.lastName ?? null,
        email: values.email ?? null, phone: values.phone ?? null, preferred_locale: values.preferredLocale ?? null,
        country_code: values.countryCode ?? null,
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: gk.guests(hotelId) }),
  });
}

export function useUpdateGuest(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<GuestProfile> }) => {
      const row: Record<string, unknown> = {};
      if ("firstName" in patch) row.first_name = patch.firstName;
      if ("lastName" in patch) row.last_name = patch.lastName;
      if ("email" in patch) row.email = patch.email;
      if ("phone" in patch) row.phone = patch.phone;
      if ("preferredLocale" in patch) row.preferred_locale = patch.preferredLocale;
      if ("countryCode" in patch) row.country_code = patch.countryCode;
      const { error } = await sb().from("guests").update(row).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: gk.guests(hotelId) }); qc.invalidateQueries({ queryKey: gk.guest(id) }); },
  });
}

/** GDPR pseudonymization (hotel_admin/platform_admin only, enforced by the RPC). */
export function usePseudonymizeGuest(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb().rpc("pseudonymize_guest", { p_guest: id });
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: gk.guests(hotelId) }); qc.invalidateQueries({ queryKey: gk.guest(id) }); },
  });
}

// ── Duplicate suggestions (review only; never auto-merge) ─────────────────────
export function useDuplicateSuggestions(hotelId?: string) {
  return useQuery({
    queryKey: gk.duplicates(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<DuplicateSuggestion[]> => {
      const { data, error } = await sb()
        .from("guest_duplicate_suggestions")
        .select("id,status,match_reason,match_score,guest_id,candidate_guest_id,created_at,reviewed_at, guest:guests!guest_duplicate_suggestions_guest_id_fkey(first_name,last_name,pseudonymized_at), candidate:guests!guest_duplicate_suggestions_candidate_guest_id_fkey(first_name,last_name,pseudonymized_at)")
        .eq("hotel_id", hotelId)
        .order("match_score", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((d: any): DuplicateSuggestion => ({
        id: d.id, status: d.status, matchReason: d.match_reason, matchScore: d.match_score,
        guestId: d.guest_id, candidateGuestId: d.candidate_guest_id,
        guestName: fullName(d.guest?.first_name, d.guest?.last_name, !!d.guest?.pseudonymized_at),
        candidateName: fullName(d.candidate?.first_name, d.candidate?.last_name, !!d.candidate?.pseudonymized_at),
        createdAt: d.created_at, reviewedAt: d.reviewed_at,
      }));
    },
  });
}

/** Confirm / dismiss / defer a suggestion. Merge is deliberately NOT implemented
 *  (no safe merge primitive in the schema) — confirming only records the review. */
export function useReviewDuplicate(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "confirmed" | "rejected" | "pending" }) => {
      const { error } = await sb().from("guest_duplicate_suggestions").update({ status: decision, reviewed_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: gk.duplicates(hotelId) }),
  });
}
