"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { CampaignRecipient, NewsletterEvent, WebhookEvent } from "./newsletter-types";

const sb = () => getSupabaseBrowserClient();

export function useCampaignRecipients(campaignId?: string) {
  return useQuery({
    queryKey: ["newsletter", "recipients", campaignId],
    enabled: !!campaignId,
    queryFn: async (): Promise<CampaignRecipient[]> => {
      const { data, error } = await sb().from("newsletter_campaign_recipients").select("id,subscriber_id,delivery_status,error_code,sent_at,delivered_at,opened_at,clicked_at,bounced_at,unsubscribed_at").eq("campaign_id", campaignId).order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r: any): CampaignRecipient => ({
        id: r.id, subscriberId: r.subscriber_id, deliveryStatus: r.delivery_status, errorCode: r.error_code,
        sentAt: r.sent_at, deliveredAt: r.delivered_at, openedAt: r.opened_at, clickedAt: r.clicked_at, bouncedAt: r.bounced_at, unsubscribedAt: r.unsubscribed_at,
      }));
    },
  });
}

/** Append-only delivery/open/click/bounce/unsubscribe events (readable by hotel_admin/marketing). */
export function useCampaignEvents(campaignId?: string) {
  return useQuery({
    queryKey: ["newsletter", "events", campaignId],
    enabled: !!campaignId,
    queryFn: async (): Promise<NewsletterEvent[]> => {
      const { data, error } = await sb().from("newsletter_events").select("id,event_type,occurred_at,subscriber_id,recipient_id").eq("campaign_id", campaignId).order("occurred_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []).map((e: any): NewsletterEvent => ({ id: e.id, eventType: e.event_type, occurredAt: e.occurred_at, subscriberId: e.subscriber_id, recipientId: e.recipient_id }));
    },
  });
}

/** A subscriber's own delivery events across campaigns (activity timeline). */
export function useSubscriberEvents(subscriberId?: string) {
  return useQuery({
    queryKey: ["newsletter", "subscriberEvents", subscriberId],
    enabled: !!subscriberId,
    queryFn: async (): Promise<(NewsletterEvent & { campaignId: string | null })[]> => {
      const { data, error } = await sb().from("newsletter_events").select("id,event_type,occurred_at,subscriber_id,recipient_id,campaign_id").eq("subscriber_id", subscriberId).order("occurred_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []).map((e: any) => ({ id: e.id, eventType: e.event_type, occurredAt: e.occurred_at, subscriberId: e.subscriber_id, recipientId: e.recipient_id, campaignId: e.campaign_id }));
    },
  });
}

/**
 * Provider (webhook) events — the raw table has NO authenticated grant (backend
 * only), so they are read through a server route that redacts the payload to a
 * short human summary. Never the raw JSON. Returns [] if none / unavailable.
 */
export function useWebhookEvents(campaignId?: string) {
  return useQuery({
    queryKey: ["newsletter", "webhookEvents", campaignId],
    enabled: !!campaignId,
    retry: false,
    queryFn: async (): Promise<WebhookEvent[]> => {
      const { data } = await sb().auth.getSession();
      const token = data.session?.access_token;
      if (!token) return [];
      const res = await fetch(`/api/newsletter/webhook-events?campaignId=${encodeURIComponent(campaignId as string)}`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) return [];
      return (await res.json()).events ?? [];
    },
  });
}
