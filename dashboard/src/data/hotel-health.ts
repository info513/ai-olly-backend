"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isRequestOverdue } from "./reception";

const sb = () => getSupabaseBrowserClient();

export const HEALTH_FORMULA_VERSION = "health-v1";
export type HealthStatus = "healthy" | "attention" | "critical" | "unavailable";
export interface HealthReason { text: string; href?: string }
export interface HealthDimension {
  key: string;
  label: string;
  status: HealthStatus;
  headline: string;
  reasons: HealthReason[];
}
export interface HotelHealth {
  dimensions: HealthDimension[];
  overall: HealthStatus;           // summary of dimensions (worst-of), NOT an opaque number
  formulaVersion: string;
}

const worst = (a: HealthStatus, b: HealthStatus): HealthStatus => {
  const rank: Record<HealthStatus, number> = { critical: 3, attention: 2, healthy: 1, unavailable: 0 };
  return rank[a] >= rank[b] ? a : b;
};

/**
 * Hotel Health = a summary of independent, explainable dimensions (Part 5). Each
 * dimension shows its own status + direct reasons/links. The overall is simply the
 * worst dimension the role can see — never an opaque weighted score. Dimensions the
 * current role can't read (RLS returns nothing) are marked "unavailable".
 */
export function useHotelHealth(hotelId?: string) {
  return useQuery({
    queryKey: ["hotelHealth", hotelId],
    enabled: !!hotelId,
    queryFn: async (): Promise<HotelHealth> => {
      const now = Date.now();
      const [kR, svcR, reqR, staysR, consR, assetsR, usagesR, subsR, statesR, campsR] = await Promise.all([
        sb().from("knowledge_articles").select("is_critical,status,valid_to,available_to_ai,approved_answer").or(`hotel_id.eq.${hotelId},hotel_id.is.null`),
        sb().from("hotel_services").select("status,valid_to,available_to_ai").eq("hotel_id", hotelId),
        sb().from("guest_requests").select("status,priority,created_at").eq("hotel_id", hotelId),
        sb().from("stays").select("id,status,guest_id").eq("hotel_id", hotelId),
        sb().from("consents").select("stay_id,guest_id,status").eq("hotel_id", hotelId),
        sb().from("assets").select("id,asset_type,alt_text,rights_owner,deleted_at,mime_type").eq("hotel_id", hotelId).is("deleted_at", null),
        sb().from("asset_usages").select("asset_id").eq("hotel_id", hotelId),
        sb().from("newsletter_subscribers").select("id,status").eq("hotel_id", hotelId),
        sb().rpc("newsletter_consent_status", { p_hotel: hotelId }),
        sb().from("newsletter_campaigns").select("status").eq("hotel_id", hotelId),
      ]);

      const dims: HealthDimension[] = [];

      // 1) AI readiness
      {
        const arts = kR.data ?? [];
        const expiredCritical = arts.filter((a: any) => a.is_critical && a.status === "published" && a.valid_to && new Date(a.valid_to).getTime() < now).length;
        const criticalDrafts = arts.filter((a: any) => a.is_critical && a.status !== "published").length;
        const missingAnswer = arts.filter((a: any) => a.available_to_ai && !a.approved_answer).length;
        const reasons: HealthReason[] = [];
        if (expiredCritical) reasons.push({ text: `${expiredCritical} critical article(s) past validity`, href: "/ai/knowledge?filter=expired-critical" });
        if (criticalDrafts) reasons.push({ text: `${criticalDrafts} critical change(s) not published`, href: "/ai/knowledge?filter=critical-pending" });
        if (missingAnswer) reasons.push({ text: `${missingAnswer} AI-visible article(s) missing an approved answer`, href: "/ai/knowledge?filter=missing-answer" });
        dims.push({ key: "ai", label: "AI readiness", status: expiredCritical ? "critical" : (criticalDrafts || missingAnswer) ? "attention" : "healthy", headline: reasons[0]?.text ?? "Knowledge is current and answerable", reasons });
      }

      // 2) Content completeness
      {
        const svc = svcR.data ?? [];
        const drafts = svc.filter((s: any) => s.status === "draft").length + (kR.data ?? []).filter((a: any) => a.status === "draft").length;
        const expired = svc.filter((s: any) => s.status === "published" && s.valid_to && new Date(s.valid_to).getTime() < now).length;
        const reasons: HealthReason[] = [];
        if (expired) reasons.push({ text: `${expired} service(s) expired`, href: "/content/services?status=published" });
        if (drafts) reasons.push({ text: `${drafts} draft(s) awaiting publish`, href: "/content" });
        dims.push({ key: "content", label: "Content completeness", status: expired ? "attention" : drafts > 5 ? "attention" : "healthy", headline: reasons[0]?.text ?? "Content is published and in-date", reasons });
      }

      // 3) Operational responsiveness (reception/hotel_admin)
      {
        const req = reqR.data ?? [];
        if (req.length === 0 && (reqR as any).error) dims.push(unavailable("ops", "Operational responsiveness"));
        else {
          const overdue = req.filter((r: any) => isRequestOverdue({ status: r.status, priority: r.priority, createdAt: r.created_at }));
          const urgentOverdue = overdue.filter((r: any) => r.priority === "urgent" || r.priority === "high").length;
          const reasons: HealthReason[] = [];
          if (overdue.length) reasons.push({ text: `${overdue.length} overdue request(s)${urgentOverdue ? `, ${urgentOverdue} high-priority` : ""}`, href: "/reception/requests?filter=overdue" });
          dims.push({ key: "ops", label: "Operational responsiveness", status: urgentOverdue ? "critical" : overdue.length ? "attention" : "healthy", headline: reasons[0]?.text ?? "No overdue requests", reasons });
        }
      }

      // 4) Guest consent readiness
      {
        const stays = staysR.data ?? [];
        const inHouse = stays.filter((s: any) => s.status === "checked_in");
        const grantedStay = new Set<string>(); const grantedGuest = new Set<string>();
        for (const c of consR.data ?? []) if (c.status === "granted") { if (c.stay_id) grantedStay.add(c.stay_id); if (c.guest_id) grantedGuest.add(c.guest_id); }
        const missing = inHouse.filter((s: any) => !grantedStay.has(s.id) && !(s.guest_id && grantedGuest.has(s.guest_id))).length;
        const reasons: HealthReason[] = [];
        if (missing) reasons.push({ text: `${missing} in-house stay(s) without consent`, href: "/reception" });
        dims.push({ key: "consent", label: "Guest consent readiness", status: missing > 2 ? "critical" : missing ? "attention" : "healthy", headline: reasons[0]?.text ?? "Every in-house stay has consent", reasons });
      }

      // 5) Asset health
      {
        const assets = assetsR.data ?? [];
        const used = new Set((usagesR.data ?? []).map((u: any) => u.asset_id));
        const isImg = (a: any) => ["hotel_image", "room_image", "poi_image", "route_image", "whisper_image", "news_image", "logo", "icon"].includes(a.asset_type);
        const missingAlt = assets.filter((a: any) => isImg(a) && !a.alt_text).length;
        const missingRights = assets.filter((a: any) => !["consent_signature", "consent_pdf", "document"].includes(a.asset_type) && !a.rights_owner).length;
        const unused = assets.filter((a: any) => !used.has(a.id) && !["consent_signature", "consent_pdf", "document"].includes(a.asset_type)).length;
        const reasons: HealthReason[] = [];
        if (missingAlt) reasons.push({ text: `${missingAlt} image(s) missing alt text`, href: "/assets/images?filter=missing-alt" });
        if (missingRights) reasons.push({ text: `${missingRights} asset(s) missing rights`, href: "/assets?filter=missing-rights" });
        if (unused) reasons.push({ text: `${unused} unused asset(s)`, href: "/assets/usage?filter=unused" });
        dims.push({ key: "assets", label: "Asset health", status: (missingAlt || missingRights) ? "attention" : "healthy", headline: reasons[0]?.text ?? "Assets are labelled and in use", reasons });
      }

      // 6) Newsletter readiness (hotel_admin/marketing)
      {
        const subs = subsR.data ?? [];
        if (subs.length === 0 && (subsR as any).error) dims.push(unavailable("newsletter", "Newsletter readiness"));
        else {
          const stateBy = new Map((statesR.data ?? []).map((x: any) => [x.subscriber_id, x.consent_state]));
          const active = subs.filter((s: any) => s.status === "subscribed");
          const consentMissing = active.filter((s: any) => stateBy.get(s.id) !== "active").length;
          const scheduled = (campsR.data ?? []).filter((c: any) => c.status === "scheduled").length;
          const reasons: HealthReason[] = [];
          if (consentMissing) reasons.push({ text: `${consentMissing} subscribed but consent not active`, href: "/newsletter/subscribers?filter=consent-missing" });
          if (scheduled) reasons.push({ text: `${scheduled} campaign(s) scheduled`, href: "/newsletter/campaigns?filter=scheduled" });
          dims.push({ key: "newsletter", label: "Newsletter readiness", status: consentMissing > active.length / 2 && active.length > 0 ? "attention" : "healthy", headline: reasons[0]?.text ?? "Subscribers consented; nothing blocking", reasons });
        }
      }

      const overall = dims.reduce((acc, d) => worst(acc, d.status), "healthy" as HealthStatus);
      return { dimensions: dims, overall, formulaVersion: HEALTH_FORMULA_VERSION };
    },
  });
}

function unavailable(key: string, label: string): HealthDimension {
  return { key, label, status: "unavailable", headline: "Not available for your role", reasons: [] };
}
