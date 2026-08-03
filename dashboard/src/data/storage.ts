"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { TRANSFORM_PRESETS, type TransformPreset, type BucketName } from "./asset-constants";
import type { AssetSummary, AssetDetail } from "./asset-types";

const sb = () => getSupabaseBrowserClient();

/** Public URL for a public-media asset (only meaningful when public_access). */
export function publicUrl(a: { bucketName: BucketName | null; storagePath: string | null; publicAccess: boolean }): string | null {
  if (a.bucketName !== "public-media" || !a.storagePath || !a.publicAccess) return null;
  return sb().storage.from("public-media").getPublicUrl(a.storagePath).data.publicUrl;
}

/** Transformed public URL (one original; Supabase image render). Falls back to
 *  the untransformed public URL when transforms are unavailable on the project —
 *  we never fabricate physical copies. */
export function transformedUrl(
  a: { bucketName: BucketName | null; storagePath: string | null; publicAccess: boolean }, preset: TransformPreset
): string | null {
  if (a.bucketName !== "public-media" || !a.storagePath || !a.publicAccess) return null;
  const t = TRANSFORM_PRESETS[preset];
  if (!t) return sb().storage.from("public-media").getPublicUrl(a.storagePath).data.publicUrl;
  return sb().storage.from("public-media").getPublicUrl(a.storagePath, { transform: { width: t.width, height: t.height, resize: t.resize } }).data.publicUrl;
}

const bearer = async () => {
  const { data } = await sb().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  return token;
};

/** Request a short-lived signed URL for a PRIVATE asset via the server route.
 *  The service-role key never touches the browser; authorization is RLS-checked
 *  server-side. Returns null if unavailable. */
export async function getSignedUrl(assetId: string): Promise<{ url: string; expiresIn: number } | null> {
  const token = await bearer();
  const res = await fetch("/api/assets/signed-url", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ assetId }),
  });
  if (res.status === 403) throw new Error("You’re not allowed to view this file.");
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Could not open the file.");
  return res.json();
}

export interface PrivateUploadInput {
  file: File;
  assetType: "consent_signature" | "consent_pdf" | "document";
  hotelId: string;
  displayName?: string;
}

/** Upload a PRIVATE file (signature / document) through the server route.
 *  Browser never writes to the private buckets directly. Returns the new asset id. */
export async function uploadPrivate(input: PrivateUploadInput): Promise<{ assetId: string }> {
  const token = await bearer();
  const fd = new FormData();
  fd.append("file", input.file);
  fd.append("assetType", input.assetType);
  fd.append("hotelId", input.hotelId);
  if (input.displayName) fd.append("displayName", input.displayName);
  const res = await fetch("/api/assets/private-upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
  if (res.status === 403) throw new Error("You’re not allowed to upload consent files.");
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Upload failed.");
  return res.json();
}

/** Upload a PUBLIC asset directly to public-media (RLS + can_manage_media gate
 *  the path). Path convention: hotels/{hotelId}/{folder}/{id}/{safeName}. */
export async function uploadPublicObject(bucket: "public-media", path: string, file: File, onProgress?: (pct: number) => void): Promise<void> {
  // supabase-js upload has no progress event; emit coarse start/finish.
  onProgress?.(10);
  const { error } = await sb().storage.from(bucket).upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
  if (error) throw error;
  onProgress?.(100);
}

export async function removePublicObject(path: string): Promise<void> {
  await sb().storage.from("public-media").remove([path]);
}

export const previewableImage = (a: AssetSummary | AssetDetail) =>
  a.mimeType?.startsWith("image/") && a.mimeType !== "image/svg+xml" ? true : a.mimeType === "image/svg+xml";
