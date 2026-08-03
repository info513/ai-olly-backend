"use client";

import { Lock, ImageOff, Copyright, Link2Off, Archive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ASSET_TYPE_LABEL, SCOPE_LABEL, type AssetType, type OwnerScope, type AssetStatus } from "@/data/asset-constants";

export function TypeBadge({ type }: { type: AssetType }) {
  return <Badge tone="neutral">{ASSET_TYPE_LABEL[type]}</Badge>;
}

export function ScopeBadge({ scope }: { scope: OwnerScope }) {
  const tone = scope === "platform" ? "brand" : scope === "destination" ? "info" : "neutral";
  return <Badge tone={tone}>{SCOPE_LABEL[scope]}</Badge>;
}

const STATUS: Record<AssetStatus, { label: string; tone: "warning" | "success" | "neutral" }> = {
  pending: { label: "Processing", tone: "warning" }, ready: { label: "Ready", tone: "success" }, archived: { label: "Archived", tone: "neutral" },
};
export function StatusBadge({ status }: { status: AssetStatus }) {
  const s = STATUS[status];
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

export function PrivateBadge() {
  return <Badge tone="warning" className="gap-1"><Lock className="h-3 w-3" /> Private</Badge>;
}

export function MissingAltChip() {
  return <span className="inline-flex items-center gap-1 rounded bg-warning-soft/50 px-1.5 py-0.5 text-[10px] font-medium text-warning" title="No alt text"><ImageOff className="h-3 w-3" /> No alt</span>;
}
export function MissingRightsChip() {
  return <span className="inline-flex items-center gap-1 rounded bg-warning-soft/50 px-1.5 py-0.5 text-[10px] font-medium text-warning" title="No rights/source"><Copyright className="h-3 w-3" /> No rights</span>;
}
export function UnusedChip() {
  return <span className="inline-flex items-center gap-1 rounded bg-surface-overlay px-1.5 py-0.5 text-[10px] font-medium text-ink-tertiary" title="Not used anywhere"><Link2Off className="h-3 w-3" /> Unused</span>;
}
export function ArchivedChip() {
  return <span className="inline-flex items-center gap-1 rounded bg-surface-overlay px-1.5 py-0.5 text-[10px] font-medium text-ink-tertiary"><Archive className="h-3 w-3" /> Archived</span>;
}
