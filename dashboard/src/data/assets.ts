"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isPrivateType, assetKind, type AssetType } from "./asset-constants";
import type { AssetSummary, AssetDetail, AssetsSummary } from "./asset-types";

const sb = () => getSupabaseBrowserClient();

export const ak = {
  assets: (h?: string) => ["assets", "list", h] as const,
  asset: (id?: string) => ["assets", "item", id] as const,
  summary: (h?: string) => ["assets", "summary", h] as const,
  usages: (id?: string) => ["assets", "usages", id] as const,
};

const SELECT = "id,hotel_id,destination_id,owner_scope,bucket_name,storage_path,external_provider,external_url,external_id,original_filename,display_name,asset_type,mime_type,file_size_bytes,width,height,duration_seconds,checksum,alt_text,caption,source_credit,rights_owner,rights_notes,license_type,status,public_access,created_at,updated_at,deleted_at";

function mapSummary(a: any, usageCount = 0): AssetSummary {
  return {
    id: a.id, displayName: a.display_name || a.original_filename || "Untitled", originalFilename: a.original_filename,
    assetType: a.asset_type, scope: a.owner_scope, mimeType: a.mime_type, fileSizeBytes: a.file_size_bytes,
    width: a.width, height: a.height, durationSeconds: a.duration_seconds, status: a.status, publicAccess: a.public_access,
    isPrivate: isPrivateType(a.asset_type), isExternal: !!a.external_provider, externalProvider: a.external_provider,
    hasAltText: !!(a.alt_text && a.alt_text.trim()), hasRights: !!(a.rights_owner || a.license_type),
    usageCount, createdAt: a.created_at, bucketName: a.bucket_name, storagePath: a.storage_path,
  };
}
function mapDetail(a: any, usageCount = 0): AssetDetail {
  return {
    ...mapSummary(a, usageCount), hotelId: a.hotel_id, destinationId: a.destination_id, caption: a.caption,
    altText: a.alt_text, sourceCredit: a.source_credit, rightsOwner: a.rights_owner, rightsNotes: a.rights_notes,
    licenseType: a.license_type, externalUrl: a.external_url, externalId: a.external_id, checksum: a.checksum,
    updatedAt: a.updated_at, deletedAt: a.deleted_at,
  };
}

async function usageCounts(assetIds: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (!assetIds.length) return m;
  const { data } = await sb().from("asset_usages").select("asset_id").in("asset_id", assetIds);
  for (const u of data ?? []) m.set(u.asset_id, (m.get(u.asset_id) ?? 0) + 1);
  return m;
}

export function useAssets(hotelId?: string, opts?: { includeArchived?: boolean }) {
  return useQuery({
    queryKey: [...ak.assets(hotelId), opts?.includeArchived ?? false] as const,
    enabled: !!hotelId,
    queryFn: async (): Promise<AssetSummary[]> => {
      let q = sb().from("assets").select(SELECT).or(`hotel_id.eq.${hotelId},hotel_id.is.null`).order("created_at", { ascending: false });
      if (!opts?.includeArchived) q = q.is("deleted_at", null);
      const { data, error } = await q;
      if (error) throw error;
      const counts = await usageCounts((data ?? []).map((a: any) => a.id));
      return (data ?? []).map((a: any) => mapSummary(a, counts.get(a.id) ?? 0));
    },
  });
}

export function useAsset(id?: string) {
  return useQuery({
    queryKey: ak.asset(id),
    enabled: !!id,
    queryFn: async (): Promise<AssetDetail> => {
      const { data, error } = await sb().from("assets").select(SELECT).eq("id", id).single();
      if (error) throw error;
      const counts = await usageCounts([id!]);
      return mapDetail(data, counts.get(id!) ?? 0);
    },
  });
}

export function useAssetsSummary(hotelId?: string) {
  return useQuery({
    queryKey: ak.summary(hotelId),
    enabled: !!hotelId,
    queryFn: async (): Promise<AssetsSummary> => {
      const { data, error } = await sb().from("assets").select(SELECT).or(`hotel_id.eq.${hotelId},hotel_id.is.null`).order("created_at", { ascending: false });
      if (error) throw error;
      const all = data ?? [];
      const live = all.filter((a: any) => !a.deleted_at);
      const counts = await usageCounts(live.map((a: any) => a.id));
      const S = live.map((a: any) => mapSummary(a, counts.get(a.id) ?? 0));
      const isImageLike = (a: AssetSummary) => ["image", "logo", "icon"].includes(assetKind(a.assetType));
      const kinds = { images: 0, videos: 0, audio: 0, documents: 0, logos: 0, icons: 0 };
      for (const a of S) {
        const k = assetKind(a.assetType);
        if (k === "image") kinds.images++; else if (k === "video") kinds.videos++; else if (k === "audio") kinds.audio++;
        else if (k === "document") kinds.documents++; else if (k === "logo") kinds.logos++; else if (k === "icon") kinds.icons++;
      }
      return {
        total: S.length,
        storageBytes: S.reduce((n, a) => n + (a.fileSizeBytes ?? 0), 0),
        recent: S.slice(0, 6),
        unused: S.filter((a) => a.usageCount === 0 && !a.isPrivate).slice(0, 20),
        missingAlt: S.filter((a) => isImageLike(a) && !a.hasAltText).slice(0, 20),
        missingRights: S.filter((a) => !a.isPrivate && !a.hasRights).slice(0, 20),
        consentFiles: S.filter((a) => a.isPrivate).length,
        archived: all.filter((a: any) => a.deleted_at).length,
        byKind: kinds,
      };
    },
  });
}

// ── Public asset creation (row insert + finalize; file already uploaded) ──────
export interface CreatePublicAssetInput {
  hotelId: string; assetType: AssetType; storagePath: string; originalFilename: string; displayName: string;
  mimeType: string; fileSizeBytes: number; width?: number | null; height?: number | null; durationSeconds?: number | null;
  altText?: string | null; caption?: string | null; sourceCredit?: string | null; rightsOwner?: string | null; licenseType?: string | null;
  publicAccess?: boolean;
}
export function useCreatePublicAsset(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: CreatePublicAssetInput) => {
      const { data, error } = await sb().from("assets").insert({
        hotel_id: v.hotelId, asset_type: v.assetType, bucket_name: "public-media", storage_path: v.storagePath,
        original_filename: v.originalFilename, display_name: v.displayName, mime_type: v.mimeType, file_size_bytes: v.fileSizeBytes,
        width: v.width ?? null, height: v.height ?? null, duration_seconds: v.durationSeconds ?? null,
        alt_text: v.altText ?? null, caption: v.caption ?? null, source_credit: v.sourceCredit ?? null,
        rights_owner: v.rightsOwner ?? null, license_type: v.licenseType ?? null, public_access: v.publicAccess ?? true, status: "pending",
      }).select("id").single();
      if (error) throw error;
      const { error: fErr } = await sb().rpc("finalize_asset", { p_asset: data.id, p_size: v.fileSizeBytes, p_width: v.width ?? null, p_height: v.height ?? null, p_duration: v.durationSeconds ?? null });
      if (fErr) throw fErr;
      return data.id as string;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ak.assets(hotelId) }); qc.invalidateQueries({ queryKey: ak.summary(hotelId) }); },
  });
}

/** External-video asset (metadata only; no upload — Vimeo/YouTube/CDN). */
export function useCreateExternalAsset(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { assetType: AssetType; provider: string; url: string; externalId?: string; displayName: string; caption?: string }) => {
      const { data, error } = await sb().from("assets").insert({
        hotel_id: hotelId, asset_type: v.assetType, external_provider: v.provider, external_url: v.url, external_id: v.externalId ?? null,
        display_name: v.displayName, caption: v.caption ?? null, status: "ready",
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ak.assets(hotelId) }); qc.invalidateQueries({ queryKey: ak.summary(hotelId) }); },
  });
}

export function useUpdateAsset(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<AssetDetail> }) => {
      const row: Record<string, unknown> = {};
      const map: Record<string, string> = { displayName: "display_name", altText: "alt_text", caption: "caption", sourceCredit: "source_credit", rightsOwner: "rights_owner", rightsNotes: "rights_notes", licenseType: "license_type", externalUrl: "external_url", externalId: "external_id" };
      for (const [k, col] of Object.entries(map)) if (k in patch) row[col] = (patch as any)[k];
      const { error } = await sb().from("assets").update(row).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ak.assets(hotelId) }); qc.invalidateQueries({ queryKey: ak.asset(id) }); qc.invalidateQueries({ queryKey: ak.summary(hotelId) }); },
  });
}

/** Archive (soft-delete). The DB blocks this while active usages exist. */
export function useArchiveAsset(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb().from("assets").update({ deleted_at: new Date().toISOString(), status: "archived" }).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ak.assets(hotelId) }); qc.invalidateQueries({ queryKey: ak.asset(id) }); qc.invalidateQueries({ queryKey: ak.summary(hotelId) }); },
  });
}

export function useRestoreAsset(hotelId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb().from("assets").update({ deleted_at: null, status: "ready" }).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ak.assets(hotelId) }); qc.invalidateQueries({ queryKey: ak.asset(id) }); qc.invalidateQueries({ queryKey: ak.summary(hotelId) }); },
  });
}
