"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Segment, SegmentRules, SegmentRuleCondition, AudiencePreview, AudienceRow } from "./newsletter-types";

const sb = () => getSupabaseBrowserClient();

export const segk = {
  list: (h?: string) => ["newsletter", "segments", h] as const,
  item: (id?: string) => ["newsletter", "segment", id] as const,
  members: (id?: string) => ["newsletter", "segmentMembers", id] as const,
  audience: (id?: string) => ["newsletter", "audience", id] as const,
};

const FIELD_LABEL: Record<SegmentRuleCondition["field"], string> = {
  locale: "Locale", country_code: "Country", source: "Source", status: "Status", tag: "Tag",
};
export const RULE_FIELDS: SegmentRuleCondition["field"][] = ["locale", "country_code", "source", "status", "tag"];

/** Human-readable rule summary (mirrors the DB validator's allowed shape). */
export function ruleSummary(rules: SegmentRules | null): string {
  if (!rules || !rules.conditions?.length) return "Everyone eligible (consent-filtered at send)";
  const parts = rules.conditions.map((c) => {
    const v = Array.isArray(c.value) ? c.value.join(", ") : c.value;
    return `${FIELD_LABEL[c.field]} ${c.op === "in" ? "in" : "="} ${v}`;
  });
  return parts.join(rules.match === "all" ? " AND " : " OR ");
}

/** Client-side mirror of platform.is_valid_segment_rules (no arbitrary SQL). */
export function validateRules(rules: SegmentRules | null): string | null {
  if (!rules) return null;
  if (!["all", "any"].includes(rules.match)) return "Match must be all or any.";
  for (const c of rules.conditions ?? []) {
    if (!RULE_FIELDS.includes(c.field)) return `Unsupported field: ${c.field}`;
    if (!["eq", "in"].includes(c.op)) return `Unsupported operator: ${c.op}`;
    if (c.value === undefined || c.value === "" || (Array.isArray(c.value) && c.value.length === 0)) return "Each condition needs a value.";
  }
  return null;
}

const mapSeg = (s: any, memberCount?: number): Segment => ({
  id: s.id, key: s.key, name: s.name, type: s.type, rules: s.rules ?? null, active: s.active,
  memberCount, createdAt: s.created_at,
});

export function useSegments(hotelId?: string) {
  return useQuery({
    queryKey: segk.list(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<Segment[]> => {
      const { data, error } = await sb().from("newsletter_segments").select("*").eq("hotel_id", hotelId).order("name");
      if (error) throw error;
      const ids = (data ?? []).filter((s: any) => s.type === "static").map((s: any) => s.id);
      const counts = new Map<string, number>();
      if (ids.length) {
        const { data: mem } = await sb().from("newsletter_segment_members").select("segment_id").in("segment_id", ids);
        for (const m of mem ?? []) counts.set(m.segment_id, (counts.get(m.segment_id) ?? 0) + 1);
      }
      return (data ?? []).map((s: any) => mapSeg(s, s.type === "static" ? counts.get(s.id) ?? 0 : undefined));
    },
  });
}

export function useSegment(id?: string) {
  return useQuery({
    queryKey: segk.item(id),
    enabled: !!id,
    queryFn: async (): Promise<Segment> => {
      const { data, error } = await sb().from("newsletter_segments").select("*").eq("id", id).single();
      if (error) throw error;
      return mapSeg(data);
    },
  });
}

export function useCreateSegment(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { key: string; name: string; type: "static" | "rule"; rules?: SegmentRules | null }) => {
      const { data, error } = await sb().from("newsletter_segments").insert({
        hotel_id: hotelId, key: v.key, name: v.name, type: v.type, rules: v.type === "rule" ? (v.rules ?? { match: "all", conditions: [] }) : null,
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: segk.list(hotelId) }),
  });
}

export function useUpdateSegment(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { name?: string; rules?: SegmentRules | null; active?: boolean } }) => {
      const { error } = await sb().from("newsletter_segments").update(patch).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: segk.list(hotelId) }); qc.invalidateQueries({ queryKey: segk.item(id) }); qc.invalidateQueries({ queryKey: segk.audience(id) }); },
  });
}

export function useDeleteSegment(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await sb().from("newsletter_segments").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: segk.list(hotelId) }),
  });
}

// ── Static membership ─────────────────────────────────────────────────────────
export function useSegmentMembers(segmentId?: string) {
  return useQuery({
    queryKey: segk.members(segmentId),
    enabled: !!segmentId,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await sb().from("newsletter_segment_members").select("subscriber_id").eq("segment_id", segmentId);
      if (error) throw error;
      return (data ?? []).map((m: any) => m.subscriber_id);
    },
  });
}
export function useSegmentMembership(segmentId?: string) {
  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: segk.members(segmentId) }); qc.invalidateQueries({ queryKey: segk.audience(segmentId) }); qc.invalidateQueries({ queryKey: ["newsletter", "segments"] }); };
  return {
    add: useMutation({ mutationFn: async (subscriberId: string) => { const { error } = await sb().from("newsletter_segment_members").insert({ segment_id: segmentId, subscriber_id: subscriberId }); if (error) throw error; }, onSuccess: invalidate }),
    remove: useMutation({ mutationFn: async (subscriberId: string) => { const { error } = await sb().from("newsletter_segment_members").delete().match({ segment_id: segmentId, subscriber_id: subscriberId }); if (error) throw error; }, onSuccess: invalidate }),
  };
}

// ── Audience preview (ALWAYS consent-filtered via the DB function) ────────────
const maskEmail = (e: string) => { const [u, d] = e.split("@"); return d ? `${u.slice(0, 2)}${"•".repeat(Math.max(1, u.length - 2))}@${d}` : e; };

export function useAudience(segmentId?: string) {
  return useQuery({
    queryKey: segk.audience(segmentId),
    enabled: !!segmentId,
    queryFn: async (): Promise<AudiencePreview> => {
      const { data, error } = await sb().rpc("resolve_newsletter_audience", { p_segment: segmentId });
      if (error) throw error;
      const rows = (data ?? []) as { subscriber_id: string; email: string; locale: string | null }[];
      const localeMap = new Map<string, number>();
      for (const r of rows) { const l = r.locale ?? "—"; localeMap.set(l, (localeMap.get(l) ?? 0) + 1); }
      return {
        eligible: rows.length,
        sample: rows.slice(0, 10).map((r): AudienceRow => ({ subscriberId: r.subscriber_id, email: maskEmail(r.email), locale: r.locale })),
        localeSplit: [...localeMap.entries()].map(([locale, count]) => ({ locale, count })).sort((a, b) => b.count - a.count),
      };
    },
  });
}
