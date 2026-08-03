"use client";

import { ShieldCheck, ShieldAlert, ShieldOff, Layers, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SUBSCRIBER_STATUS_LABEL, CAMPAIGN_STATUS_LABEL, type SubscriberStatus, type CampaignStatus, type ConsentState, type SegmentType } from "@/data/newsletter-types";

const SUB_TONE: Record<SubscriberStatus, "neutral" | "warning" | "success" | "danger" | "info"> = {
  pending: "warning", subscribed: "success", unsubscribed: "neutral", bounced: "danger", complained: "danger", suppressed: "neutral",
};
export function SubscriberStatusPill({ status }: { status: SubscriberStatus }) {
  return <Badge tone={SUB_TONE[status]} dot>{SUBSCRIBER_STATUS_LABEL[status]}</Badge>;
}

export function ConsentPill({ state }: { state: ConsentState }) {
  if (state === "active") return <Badge tone="success" className="gap-1"><ShieldCheck className="h-3 w-3" /> Consent active</Badge>;
  if (state === "revoked") return <Badge tone="neutral" className="gap-1"><ShieldOff className="h-3 w-3" /> Consent revoked</Badge>;
  return <Badge tone="warning" className="gap-1"><ShieldAlert className="h-3 w-3" /> Consent missing</Badge>;
}

const CAMP_TONE: Record<CampaignStatus, "neutral" | "warning" | "success" | "info" | "danger"> = {
  draft: "warning", preview: "info", scheduled: "info", sending: "info", sent: "success", cancelled: "neutral", failed: "danger",
};
export function CampaignStatusPill({ status }: { status: CampaignStatus }) {
  return <Badge tone={CAMP_TONE[status]} dot>{CAMPAIGN_STATUS_LABEL[status]}</Badge>;
}

export function SegmentTypeBadge({ type }: { type: SegmentType }) {
  return type === "static"
    ? <Badge tone="neutral" className="gap-1"><Layers className="h-3 w-3" /> Static</Badge>
    : <Badge tone="info" className="gap-1"><Filter className="h-3 w-3" /> Rule-based</Badge>;
}
