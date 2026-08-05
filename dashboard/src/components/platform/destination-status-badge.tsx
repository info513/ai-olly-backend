"use client";

import { Badge } from "@/components/ui/badge";
import type { ContentStatus, VerificationStatus } from "@/data/platform-destinations";

const STATUS_TONE: Record<ContentStatus, "neutral" | "info" | "success" | "warning" | "danger" | "brand"> = {
  draft: "neutral",
  preview: "info",
  published: "success",
  archived: "warning",
};
const STATUS_LABEL: Record<ContentStatus, string> = {
  draft: "Draft", preview: "Preview", published: "Published", archived: "Archived",
};

export function StatusBadge({ status }: { status: ContentStatus }) {
  return <Badge tone={STATUS_TONE[status]} dot>{STATUS_LABEL[status]}</Badge>;
}

const VERIF_TONE: Record<VerificationStatus, "neutral" | "success" | "warning"> = {
  unverified: "neutral", verified: "success", stale: "warning",
};
const VERIF_LABEL: Record<VerificationStatus, string> = {
  unverified: "Unverified", verified: "Verified", stale: "Stale",
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  return <Badge tone={VERIF_TONE[status]}>{VERIF_LABEL[status]}</Badge>;
}
