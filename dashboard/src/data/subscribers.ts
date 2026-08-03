"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Subscriber, SubscriberStatus, ConsentState } from "./newsletter-types";

const sb = () => getSupabaseBrowserClient();

export const subk = {
  list: (h?: string) => ["newsletter", "subscribers", h] as const,
  item: (id?: string) => ["newsletter", "subscriber", id] as const,
};

const SELECT = "id,email,first_name,last_name,locale,country_code,status,source,subscribed_at,unsubscribed_at,consent_id,brevo_contact_id,tags,guest_id,created_at";

function mapSub(s: any, consentState: ConsentState): Subscriber {
  return {
    id: s.id, email: s.email, firstName: s.first_name, lastName: s.last_name, locale: s.locale, countryCode: s.country_code,
    status: s.status, source: s.source, subscribedAt: s.subscribed_at, unsubscribedAt: s.unsubscribed_at,
    consentId: s.consent_id, consentState, brevoContactId: s.brevo_contact_id, tags: s.tags ?? [], guestId: s.guest_id, createdAt: s.created_at,
  };
}

/** Consent state per subscriber (state only, no PII) via member-scoped RPC. */
async function consentStates(hotelId: string): Promise<Map<string, ConsentState>> {
  const m = new Map<string, ConsentState>();
  const { data } = await sb().rpc("newsletter_consent_status", { p_hotel: hotelId });
  for (const r of data ?? []) m.set(r.subscriber_id, r.consent_state as ConsentState);
  return m;
}

export function useSubscribers(hotelId?: string) {
  return useQuery({
    queryKey: subk.list(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<Subscriber[]> => {
      const [{ data, error }, states] = await Promise.all([
        sb().from("newsletter_subscribers").select(SELECT).eq("hotel_id", hotelId).order("created_at", { ascending: false }),
        consentStates(hotelId!),
      ]);
      if (error) throw error;
      return (data ?? []).map((s: any) => mapSub(s, states.get(s.id) ?? "missing"));
    },
  });
}

export function useSubscriber(id?: string, hotelId?: string) {
  return useQuery({
    queryKey: subk.item(id),
    enabled: !!id,
    queryFn: async (): Promise<Subscriber> => {
      const { data, error } = await sb().from("newsletter_subscribers").select(SELECT).eq("id", id).single();
      if (error) throw error;
      let state: ConsentState = "missing";
      if (hotelId) { const m = await consentStates(hotelId); state = m.get(id!) ?? "missing"; }
      return mapSub(data, state);
    },
  });
}

export interface CreateSubscriberInput {
  email: string; firstName?: string | null; lastName?: string | null; locale?: string | null; countryCode?: string | null;
  source?: string | null; consentId?: string | null; status?: SubscriberStatus; tags?: string[];
}
export function useCreateSubscriber(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: CreateSubscriberInput) => {
      const { data, error } = await sb().from("newsletter_subscribers").insert({
        hotel_id: hotelId, email: v.email.trim(), first_name: v.firstName ?? null, last_name: v.lastName ?? null,
        locale: v.locale ?? null, country_code: v.countryCode ?? null, source: v.source ?? "dashboard",
        consent_id: v.consentId ?? null, status: v.status ?? "pending", tags: v.tags ?? null,
        subscribed_at: v.status === "subscribed" ? new Date().toISOString() : null,
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: subk.list(hotelId) }),
  });
}

function usePatch(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await sb().from("newsletter_subscribers").update(patch).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: subk.list(hotelId) }); qc.invalidateQueries({ queryKey: subk.item(id) }); },
  });
}

export function useSubscriberActions(hotelId?: string) {
  const base = usePatch(hotelId);
  return {
    ...base,
    /** Subscribe requires a granted consent id (send-time gating also enforced server-side). */
    subscribe: (id: string, consentId: string) => base.mutateAsync({ id, patch: { status: "subscribed", consent_id: consentId, subscribed_at: new Date().toISOString(), unsubscribed_at: null } }),
    unsubscribe: (id: string) => base.mutateAsync({ id, patch: { status: "unsubscribed", unsubscribed_at: new Date().toISOString() } }),
    suppress: (id: string) => base.mutateAsync({ id, patch: { status: "suppressed", unsubscribed_at: new Date().toISOString() } }),
    updateProfile: (id: string, patch: { firstName?: string | null; lastName?: string | null; locale?: string | null; tags?: string[] }) =>
      base.mutateAsync({ id, patch: {
        ...(("firstName" in patch) ? { first_name: patch.firstName } : {}),
        ...(("lastName" in patch) ? { last_name: patch.lastName } : {}),
        ...(("locale" in patch) ? { locale: patch.locale } : {}),
        ...(("tags" in patch) ? { tags: patch.tags } : {}),
      } }),
  };
}
