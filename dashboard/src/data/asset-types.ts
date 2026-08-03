import type { AssetType, AssetStatus, OwnerScope, BucketName } from "./asset-constants";

// Safe UI domain models. storagePath/bucketName are kept for building public URLs
// and signed-URL requests, but are NEVER rendered — Storage paths and tokens stay
// out of the visible UI (Part 3/5).

export interface AssetSummary {
  id: string;
  displayName: string;
  originalFilename: string | null;
  assetType: AssetType;
  scope: OwnerScope;
  mimeType: string | null;
  fileSizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  status: AssetStatus;
  publicAccess: boolean;
  isPrivate: boolean;
  isExternal: boolean;
  externalProvider: string | null;
  hasAltText: boolean;
  hasRights: boolean;
  usageCount: number;
  createdAt: string;
  // internal (not for display)
  bucketName: BucketName | null;
  storagePath: string | null;
}

export interface AssetDetail extends AssetSummary {
  hotelId: string | null;
  destinationId: string | null;
  caption: string | null;
  altText: string | null;
  sourceCredit: string | null;
  rightsOwner: string | null;
  rightsNotes: string | null;
  licenseType: string | null;
  externalUrl: string | null;
  externalId: string | null;
  checksum: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

export interface AssetUsage {
  entityType: string;
  entityId: string;
  usageRole: string;
  hotelId: string | null;
  sortOrder: number;
}

export interface AssetsSummary {
  total: number;
  storageBytes: number;
  recent: AssetSummary[];
  unused: AssetSummary[];
  missingAlt: AssetSummary[];
  missingRights: AssetSummary[];
  consentFiles: number;
  archived: number;
  byKind: { images: number; videos: number; audio: number; documents: number; logos: number; icons: number };
}
