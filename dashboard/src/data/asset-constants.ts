// Shared asset constants — mirror the DB (platform.asset_max_bytes /
// asset_is_private_type / bucket allowed_mime_types). Kept in one place so the
// client, the server upload routes and the UI validate identically. The DB is
// still the authority (CHECK + finalize_asset + bucket limits).

export type AssetType =
  | "hotel_image" | "room_image" | "poi_image" | "route_image" | "whisper_image" | "whisper_audio"
  | "short_video" | "logo" | "icon" | "news_image" | "newsletter_asset" | "document"
  | "consent_signature" | "consent_pdf" | "other";

export type AssetStatus = "pending" | "ready" | "archived";
export type OwnerScope = "platform" | "destination" | "hotel";
export type BucketName = "public-media" | "private-documents" | "consent-files";

export const PRIVATE_TYPES: AssetType[] = ["consent_signature", "consent_pdf", "document"];
export const isPrivateType = (t: AssetType) => PRIVATE_TYPES.includes(t);

const MB = 1024 * 1024;
export function assetMaxBytes(t: AssetType): number {
  switch (t) {
    case "short_video": return 100 * MB;
    case "whisper_audio": return 50 * MB;
    case "document": case "consent_pdf": return 25 * MB;
    case "consent_signature": return 5 * MB;
    default: return 15 * MB; // images / logos / icons / news / newsletter
  }
}

/** Target bucket for a logical type. External-video types have no bucket. */
export function bucketForType(t: AssetType): BucketName {
  if (t === "consent_signature") return "consent-files";
  if (t === "consent_pdf" || t === "document") return "private-documents";
  return "public-media";
}

export const BUCKET_MIME: Record<BucketName, string[]> = {
  "public-media": ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "video/mp4", "audio/mpeg", "audio/mp4"],
  "private-documents": ["application/pdf", "image/png", "image/jpeg"],
  "consent-files": ["application/pdf", "image/png", "image/jpeg", "image/svg+xml"],
};

/** Broad category of a type — for grouping and preview selection. */
export type AssetKind = "image" | "video" | "audio" | "document" | "logo" | "icon" | "consent" | "other";
export function assetKind(t: AssetType): AssetKind {
  switch (t) {
    case "hotel_image": case "room_image": case "poi_image": case "route_image": case "whisper_image": case "news_image": return "image";
    case "short_video": return "video";
    case "whisper_audio": return "audio";
    case "document": case "consent_pdf": return "document";
    case "consent_signature": return "consent";
    case "logo": return "logo";
    case "icon": return "icon";
    case "newsletter_asset": return "other";
    default: return "other";
  }
}

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  hotel_image: "Hotel image", room_image: "Room image", poi_image: "POI image", route_image: "Route image",
  whisper_image: "Whisper image", whisper_audio: "Whisper audio", short_video: "Short video", logo: "Logo",
  icon: "Icon", news_image: "News image", newsletter_asset: "Newsletter asset", document: "Document",
  consent_signature: "Consent signature", consent_pdf: "Consent PDF", other: "Other",
};

export const SCOPE_LABEL: Record<OwnerScope, string> = { platform: "Platform", destination: "Destination", hotel: "Hotel" };

export function humanBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
}

/** Sanitize a client filename to a safe storage segment. */
export function safeFilename(name: string): string {
  const base = (name || "file").split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "file";
}

/** Image transform presets (Supabase render/image). One original; URLs only. */
export const TRANSFORM_PRESETS = {
  thumb: { width: 96, height: 96, resize: "cover" as const },
  card: { width: 400, height: 300, resize: "cover" as const },
  hero: { width: 1600, height: 900, resize: "cover" as const },
  full: null,
} as const;
export type TransformPreset = keyof typeof TRANSFORM_PRESETS;
