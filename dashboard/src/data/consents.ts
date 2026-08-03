"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ConsentTemplate, SignedConsent, ConsentStatusInfo } from "./reception-types";

const sb = () => getSupabaseBrowserClient();

export const ck = {
  templates: (h?: string) => ["reception", "consentTemplates", h] as const,
  consent: (id?: string) => ["reception", "consent", id] as const,
  consents: (h?: string) => ["reception", "consents", h] as const,
  guestConsents: (g?: string) => ["reception", "guestConsents", g] as const,
  stayConsents: (s?: string) => ["reception", "stayConsents", s] as const,
};

const mapTemplate = (t: any): ConsentTemplate => ({
  id: t.id, hotelId: t.hotel_id, key: t.key, locale: t.locale, version: t.version, title: t.title,
  bodyText: t.body_text, status: t.status, active: t.active, publishedAt: t.published_at, updatedAt: t.updated_at,
});

const mapConsent = (c: any): SignedConsent => ({
  id: c.id, hotelId: c.hotel_id, guestId: c.guest_id, stayId: c.stay_id, templateId: c.template_id,
  consentType: c.consent_type, consentVersion: c.consent_version, locale: c.locale, textSnapshot: c.consent_text_snapshot,
  signedName: c.signed_name, signedAt: c.signed_at, staffUserId: c.staff_user_id, status: c.status, revokedAt: c.revoked_at,
  signatureAssetId: c.signature_asset_id ?? null, documentAssetId: c.generated_document_asset_id ?? null,
  hasSignatureAsset: !!c.signature_asset_id, hasDocumentAsset: !!c.generated_document_asset_id,
});

// ── Templates (version-per-row; only published versions are signable) ─────────
export function useConsentTemplates(hotelId?: string) {
  return useQuery({
    queryKey: ck.templates(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<ConsentTemplate[]> => {
      const { data, error } = await sb().from("consent_templates").select("*").or(`hotel_id.is.null,hotel_id.eq.${hotelId}`).order("key").order("version", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapTemplate);
    },
  });
}

/** Latest PUBLISHED version per key+locale — the signable set. */
export function signableTemplates(all: ConsentTemplate[]): ConsentTemplate[] {
  const best = new Map<string, ConsentTemplate>();
  for (const t of all) {
    if (t.status !== "published" || !t.active) continue;
    const k = `${t.hotelId ?? "platform"}:${t.key}:${t.locale}`;
    const cur = best.get(k);
    if (!cur || t.version > cur.version) best.set(k, t);
  }
  return [...best.values()];
}

export function useCreateTemplate(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { key: string; locale: string; title: string; bodyText: string }) => {
      const { data, error } = await sb().from("consent_templates").insert({
        hotel_id: hotelId, key: v.key, locale: v.locale, version: 1, title: v.title, body_text: v.bodyText, status: "draft",
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.templates(hotelId) }),
  });
}

/** Create a new DRAFT version (version+1) from an existing template's content —
 *  the only way to change wording once a version is published (content is frozen). */
export function useCreateTemplateVersion(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (source: ConsentTemplate) => {
      const { data: maxRow } = await sb().from("consent_templates").select("version").eq("hotel_id", source.hotelId).eq("key", source.key).eq("locale", source.locale).order("version", { ascending: false }).limit(1).maybeSingle();
      const nextVersion = ((maxRow?.version as number) ?? source.version) + 1;
      const { data, error } = await sb().from("consent_templates").insert({
        hotel_id: source.hotelId, key: source.key, locale: source.locale, version: nextVersion, title: source.title, body_text: source.bodyText, status: "draft",
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.templates(hotelId) }),
  });
}

export function useUpdateTemplate(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { title?: string; bodyText?: string } }) => {
      const row: Record<string, unknown> = {};
      if ("title" in patch) row.title = patch.title;
      if ("bodyText" in patch) row.body_text = patch.bodyText;
      const { error } = await sb().from("consent_templates").update(row).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.templates(hotelId) }),
  });
}

export function usePublishTemplate(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changeSummary }: { id: string; changeSummary?: string }) => {
      const { error } = await sb().rpc("publish_consent_template", { p_template: id, p_change_summary: changeSummary ?? null });
      if (error) throw error;
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.templates(hotelId) }),
  });
}

// ── Signing / revocation (real primitives) ────────────────────────────────────
export function useSignConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { templateId: string; guestId: string; stayId: string | null; signedName: string; device?: Record<string, unknown> | null; signatureAssetId?: string | null }) => {
      const { data, error } = await sb().rpc("sign_consent", { p_template: v.templateId, p_guest: v.guestId, p_stay: v.stayId, p_signed_name: v.signedName, p_device: v.device ?? null, p_signature_asset: v.signatureAssetId ?? null });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ck.guestConsents(v.guestId) });
      if (v.stayId) qc.invalidateQueries({ queryKey: ck.stayConsents(v.stayId) });
    },
  });
}

export function useRevokeConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb().rpc("revoke_consent", { p_consent: id });
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ck.consent(id) }); qc.invalidateQueries({ queryKey: ["reception", "guestConsents"] }); qc.invalidateQueries({ queryKey: ["reception", "stayConsents"] }); },
  });
}

// ── Signed consent records ────────────────────────────────────────────────────
export function useConsent(id?: string) {
  return useQuery({
    queryKey: ck.consent(id),
    enabled: !!id,
    queryFn: async (): Promise<SignedConsent> => {
      const { data, error } = await sb().from("consents").select("*").eq("id", id).single();
      if (error) throw error;
      return mapConsent(data);
    },
  });
}

/** Hotel-wide signed consents (records overview). Includes a light guest-name
 *  join for display (RLS still gates to reception/hotel_admin/platform). */
export function useConsents(hotelId?: string) {
  return useQuery({
    queryKey: ck.consents(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<(SignedConsent & { guestName: string | null })[]> => {
      const { data, error } = await sb().from("consents").select("*, guest:guests(first_name,last_name,pseudonymized_at)").eq("hotel_id", hotelId).order("signed_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []).map((c: any) => ({ ...mapConsent(c), guestName: c.guest ? (c.guest.pseudonymized_at ? "Former guest" : [c.guest.first_name, c.guest.last_name].filter(Boolean).join(" ") || null) : null }));
    },
  });
}

export function useGuestConsents(guestId?: string) {
  return useQuery({
    queryKey: ck.guestConsents(guestId),
    enabled: !!guestId,
    queryFn: async (): Promise<SignedConsent[]> => {
      const { data, error } = await sb().from("consents").select("*").eq("guest_id", guestId).order("signed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapConsent);
    },
  });
}

export function useStayConsents(stayId?: string) {
  return useQuery({
    queryKey: ck.stayConsents(stayId),
    enabled: !!stayId,
    queryFn: async (): Promise<SignedConsent[]> => {
      const { data, error } = await sb().from("consents").select("*").eq("stay_id", stayId).order("signed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapConsent);
    },
  });
}

export function consentStatusFrom(consents: SignedConsent[]): ConsentStatusInfo {
  const granted = consents.filter((c) => c.status === "granted");
  const latest = consents[0] ?? null;
  return {
    hasGranted: granted.length > 0,
    latestConsentId: latest?.id ?? null,
    latestType: latest?.consentType ?? null,
    latestSignedAt: latest?.signedAt ?? null,
    revoked: !!latest && latest.status === "revoked",
  };
}
