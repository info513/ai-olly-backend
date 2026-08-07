"use client";

// AI OLLY — Platform CMS Media (Phase 9). Platform- and destination-owned public
// media (assets with hotel_id IS NULL → owner_scope 'platform' | 'destination').
// Reuses the SAME assets table, finalize_asset RPC, asset_usages + asset_usage_report,
// the public-media storage bucket, transforms and archive-only semantics as the
// hotel Asset Manager (Sprint 6). RLS already gates hotel_id-null public assets to
// platform_admin (INSERT/UPDATE), and can_manage_media() lets platform_admin write
// platform/… and destinations/… storage paths. No new migration. No redesign.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isPrivateType, assetKind, safeFilename, type AssetType } from "./asset-constants";
import type { AssetSummary, AssetDetail } from "./asset-types";
import { uploadPublicObject } from "./storage";

const sb = () => getSupabaseBrowserClient();

export const pmk = {
  list: (dest?: string | null, arch?: boolean) => ["platform-media", "list", dest ?? "all", arch ?? false] as const,
  item: (id?: string) => ["platform-media", "item", id] as const,
  summary: (dest?: string | null) => ["platform-media", "summary", dest ?? "all"] as const,
};

const SELECT =
  "id,hotel_id,destination_id,owner_scope,bucket_name,storage_path,external_provider,external_url,external_id," +
  "original_filename,display_name,asset_type,mime_type,file_size_bytes,width,height,duration_seconds,checksum," +
  "alt_text,caption,source_credit,rights_owner,rights_notes,license_type,status,public_access,created_at,updated_at,deleted_at";

// Public media types offered at platform/destination scope (private consent/document
// types are hotel-only and are never surfaced here).
export const PLATFORM_MEDIA_TYPES: AssetType[] = [
  "hotel_image", "poi_image", "route_image", "whisper_image", "news_image", "logo", "icon", "whisper_audio", "short_video",
];

/** Grid card: an AssetSummary plus the owning destination (null = platform-wide). */
export interface MediaCard extends AssetSummary {
  destinationId: string | null;
}

function mapSummary(a: any, usageCount = 0): MediaCard {
  return {
    id: a.id, displayName: a.display_name || a.original_filename || "Untitled", originalFilename: a.original_filename,
    assetType: a.asset_type, scope: a.owner_scope, mimeType: a.mime_type, fileSizeBytes: a.file_size_bytes,
    width: a.width, height: a.height, durationSeconds: a.duration_seconds, status: a.status, publicAccess: a.public_access,
    isPrivate: isPrivateType(a.asset_type), isExternal: !!a.external_provider, externalProvider: a.external_provider,
    hasAltText: !!(a.alt_text && a.alt_text.trim()), hasRights: !!(a.rights_owner || a.license_type),
    usageCount, createdAt: a.created_at, bucketName: a.bucket_name, storagePath: a.storage_path,
    destinationId: a.destination_id ?? null,
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

/** Platform + destination media library. destinationId narrows to one destination;
 *  omit for all platform/destination-owned media (hotel_id IS NULL). */
export function usePlatformMedia(destinationId?: string | null, opts?: { includeArchived?: boolean }) {
  return useQuery({
    queryKey: pmk.list(destinationId, opts?.includeArchived),
    queryFn: async (): Promise<MediaCard[]> => {
      let q = sb().from("assets").select(SELECT).is("hotel_id", null).order("created_at", { ascending: false }).limit(1000);
      if (destinationId) q = q.eq("destination_id", destinationId);
      if (!opts?.includeArchived) q = q.is("deleted_at", null);
      const { data, error } = await q;
      if (error) throw error;
      const counts = await usageCounts((data ?? []).map((a: any) => a.id));
      return (data ?? []).map((a: any) => mapSummary(a, counts.get(a.id) ?? 0));
    },
  });
}

export function usePlatformAsset(id?: string) {
  return useQuery({
    queryKey: pmk.item(id),
    enabled: !!id,
    queryFn: async (): Promise<AssetDetail | null> => {
      const { data, error } = await sb().from("assets").select(SELECT).eq("id", id).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const counts = await usageCounts([id!]);
      return mapDetail(data, counts.get(id!) ?? 0);
    },
  });
}

export interface PlatformMediaSummary {
  total: number; storageBytes: number; archived: number;
  destinationOwned: number; platformOwned: number;
  missingAlt: number; missingRights: number; unused: number;
  byKind: { images: number; videos: number; audio: number; logos: number; icons: number; other: number };
}

export function usePlatformMediaSummary(destinationId?: string | null) {
  return useQuery({
    queryKey: pmk.summary(destinationId),
    queryFn: async (): Promise<PlatformMediaSummary> => {
      let q = sb().from("assets").select(SELECT).is("hotel_id", null).order("created_at", { ascending: false });
      if (destinationId) q = q.eq("destination_id", destinationId);
      const { data, error } = await q;
      if (error) throw error;
      const all = data ?? [];
      const live = all.filter((a: any) => !a.deleted_at);
      const counts = await usageCounts(live.map((a: any) => a.id));
      const S = live.map((a: any) => mapSummary(a, counts.get(a.id) ?? 0));
      const isImageLike = (a: AssetSummary) => ["image", "logo", "icon"].includes(assetKind(a.assetType));
      const kinds = { images: 0, videos: 0, audio: 0, logos: 0, icons: 0, other: 0 };
      for (const a of S) {
        const k = assetKind(a.assetType);
        if (k === "image") kinds.images++; else if (k === "video") kinds.videos++; else if (k === "audio") kinds.audio++;
        else if (k === "logo") kinds.logos++; else if (k === "icon") kinds.icons++; else kinds.other++;
      }
      return {
        total: S.length,
        storageBytes: S.reduce((n, a) => n + (a.fileSizeBytes ?? 0), 0),
        archived: all.filter((a: any) => a.deleted_at).length,
        destinationOwned: S.filter((a) => a.scope === "destination").length,
        platformOwned: S.filter((a) => a.scope === "platform").length,
        missingAlt: S.filter((a) => isImageLike(a) && !a.hasAltText).length,
        missingRights: S.filter((a) => !a.hasRights).length,
        unused: S.filter((a) => a.usageCount === 0).length,
        byKind: kinds,
      };
    },
  });
}

// ── Create (upload → row insert → finalize; file already uploaded). hotel_id is
//    NULL; destination_id (optional) makes it destination-owned, else platform-owned. ──
export interface CreatePlatformAssetInput {
  destinationId?: string | null;
  assetType: AssetType; storagePath: string; originalFilename: string; displayName: string;
  mimeType: string; fileSizeBytes: number; width?: number | null; height?: number | null; durationSeconds?: number | null;
  altText?: string | null; caption?: string | null; sourceCredit?: string | null; rightsOwner?: string | null;
  rightsNotes?: string | null; licenseType?: string | null;
}
export function useCreatePlatformPublicAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: CreatePlatformAssetInput) => {
      const { data, error } = await sb().from("assets").insert({
        hotel_id: null, destination_id: v.destinationId ?? null, asset_type: v.assetType, bucket_name: "public-media",
        storage_path: v.storagePath, original_filename: v.originalFilename, display_name: v.displayName, mime_type: v.mimeType,
        file_size_bytes: v.fileSizeBytes, width: v.width ?? null, height: v.height ?? null, duration_seconds: v.durationSeconds ?? null,
        alt_text: v.altText ?? null, caption: v.caption ?? null, source_credit: v.sourceCredit ?? null, rights_owner: v.rightsOwner ?? null,
        rights_notes: v.rightsNotes ?? null, license_type: v.licenseType ?? null, public_access: true, status: "pending",
      }).select("id").single();
      if (error) throw error;
      const { error: fErr } = await sb().rpc("finalize_asset", { p_asset: data.id, p_size: v.fileSizeBytes, p_width: v.width ?? null, p_height: v.height ?? null, p_duration: v.durationSeconds ?? null });
      if (fErr) throw fErr;
      return data.id as string;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform-media"] }); },
  });
}

/** External media reference (Vimeo/YouTube/CDN); metadata only, no upload. */
export function useCreatePlatformExternalAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { destinationId?: string | null; assetType: AssetType; provider: string; url: string; externalId?: string; displayName: string; caption?: string; sourceCredit?: string; rightsOwner?: string; licenseType?: string }) => {
      const { data, error } = await sb().from("assets").insert({
        hotel_id: null, destination_id: v.destinationId ?? null, asset_type: v.assetType, external_provider: v.provider,
        external_url: v.url, external_id: v.externalId ?? null, display_name: v.displayName, caption: v.caption ?? null,
        source_credit: v.sourceCredit ?? null, rights_owner: v.rightsOwner ?? null, license_type: v.licenseType ?? null, status: "ready",
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform-media"] }); },
  });
}

export function useUpdatePlatformAsset() {
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
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ["platform-media"] }); qc.invalidateQueries({ queryKey: pmk.item(id) }); },
  });
}

/** Archive (soft-delete). The DB protect trigger blocks this while active usages exist. */
export function useArchivePlatformAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb().from("assets").update({ deleted_at: new Date().toISOString(), status: "archived" }).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ["platform-media"] }); qc.invalidateQueries({ queryKey: pmk.item(id) }); },
  });
}

export function useRestorePlatformAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb().from("assets").update({ deleted_at: null, status: "ready" }).eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ["platform-media"] }); qc.invalidateQueries({ queryKey: pmk.item(id) }); },
  });
}

/** Storage path for a new platform/destination public object. Platform paths and
 *  destination paths both require platform_admin via can_manage_media(). */
export function platformMediaPath(destinationId: string | null | undefined, assetType: AssetType, id: string, filename: string): string {
  const folder = assetType.replace(/_image$|_audio$/, "").replace(/_/g, "-") || "misc";
  const root = destinationId ? `destinations/${destinationId}` : "platform";
  return `${root}/${folder}/${id}/${safeFilename(filename)}`;
}

export { uploadPublicObject };
