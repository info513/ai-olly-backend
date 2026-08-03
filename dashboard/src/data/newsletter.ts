"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { NewsletterSummary, Campaign, ConsentState } from "./newsletter-types";

const sb = () => getSupabaseBrowserClient();

const mapCampaign = (c: any): Campaign => ({
  id: c.id, hotelId: c.hotel_id, name: c.name, templateId: c.template_id, segmentId: c.segment_id,
  subjectSnapshot: c.subject_snapshot, previewTextSnapshot: c.preview_text_snapshot, contentSnapshot: c.content_snapshot,
  segmentSnapshot: c.segment_snapshot, status: c.status, scheduledAt: c.scheduled_at, sentAt: c.sent_at, brevoCampaignId: c.brevo_campaign_id,
  totals: { recipients: c.recipient_total ?? 0, delivered: c.delivered_total ?? 0, opened: c.opened_total ?? 0, clicked: c.clicked_total ?? 0, bounced: c.bounced_total ?? 0, unsubscribed: c.unsubscribed_total ?? 0 },
  createdAt: c.created_at,
});

export function useNewsletterSummary(hotelId?: string) {
  return useQuery({
    queryKey: ["newsletter", "summary", hotelId],
    enabled: !!hotelId,
    queryFn: async (): Promise<NewsletterSummary> => {
      const [subsR, campsR, statesR] = await Promise.all([
        sb().from("newsletter_subscribers").select("id,status").eq("hotel_id", hotelId),
        sb().from("newsletter_campaigns").select("*").eq("hotel_id", hotelId).order("created_at", { ascending: false }),
        sb().rpc("newsletter_consent_status", { p_hotel: hotelId }),
      ]);
      if (subsR.error) throw subsR.error;
      const subs = subsR.data ?? [];
      const stateBy = new Map<string, ConsentState>();
      for (const r of statesR.data ?? []) stateBy.set(r.subscriber_id, r.consent_state as ConsentState);

      const active = subs.filter((s: any) => s.status === "subscribed");
      const validConsent = active.filter((s: any) => stateBy.get(s.id) === "active").length;
      const unsubSupp = subs.filter((s: any) => ["unsubscribed", "suppressed", "bounced", "complained"].includes(s.status)).length;
      const consentMissing = active.filter((s: any) => stateBy.get(s.id) !== "active").length;

      const camps = (campsR.data ?? []).map(mapCampaign);
      const drafts = camps.filter((c) => c.status === "draft" || c.status === "preview").length;
      const scheduled = camps.filter((c) => c.status === "scheduled").length;
      const last = camps.find((c) => c.status === "sent") ?? camps.find((c) => c.status === "scheduled") ?? null;

      return {
        activeSubscribers: active.length, validConsent, unsubscribedSuppressed: unsubSupp, consentMissing,
        draftCampaigns: drafts, scheduledCampaigns: scheduled, lastCampaign: last, totalSubscribers: subs.length,
      };
    },
  });
}
