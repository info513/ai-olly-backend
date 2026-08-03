"use client";

import { AlertTriangle, Star, ShieldCheck, ShieldAlert, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  STAY_STATUS_LABEL, REQUEST_STATUS_LABEL, PRIORITY_LABEL,
  type StayStatus, type RequestStatus, type RequestPriority, type FeedbackStatus,
} from "@/data/reception-types";

const STAY_TONE: Record<StayStatus, "neutral" | "warning" | "success" | "info" | "danger"> = {
  reserved: "info", checked_in: "success", checked_out: "neutral", cancelled: "neutral", no_show: "warning",
};
export function StayStatusPill({ status }: { status: StayStatus }) {
  return <Badge tone={STAY_TONE[status]} dot>{STAY_STATUS_LABEL[status]}</Badge>;
}

const REQ_TONE: Record<RequestStatus, "neutral" | "warning" | "success" | "info" | "danger"> = {
  new: "warning", acknowledged: "info", in_progress: "info", resolved: "success", closed: "neutral", cancelled: "neutral",
};
export function RequestStatusPill({ status }: { status: RequestStatus }) {
  return <Badge tone={REQ_TONE[status]} dot>{REQUEST_STATUS_LABEL[status]}</Badge>;
}

const PRIO_TONE: Record<RequestPriority, "neutral" | "warning" | "danger" | "info"> = {
  low: "neutral", normal: "info", high: "warning", urgent: "danger",
};
export function PriorityPill({ priority }: { priority: RequestPriority }) {
  if (priority === "normal" || priority === "low") return <span className="text-[12px] text-ink-tertiary">{PRIORITY_LABEL[priority]}</span>;
  return <Badge tone={PRIO_TONE[priority]} className="gap-1">{priority === "urgent" && <AlertTriangle className="h-3 w-3" />}{PRIORITY_LABEL[priority]}</Badge>;
}

const FB_TONE: Record<FeedbackStatus, "warning" | "info" | "success"> = { new: "warning", reviewed: "info", resolved: "success" };
export function FeedbackStatusPill({ status }: { status: FeedbackStatus }) {
  return <Badge tone={FB_TONE[status]} dot className="capitalize">{status}</Badge>;
}

export function ConsentPill({ hasConsent, revoked }: { hasConsent: boolean; revoked?: boolean }) {
  if (revoked) return <Badge tone="neutral" className="gap-1"><ShieldAlert className="h-3 w-3" /> Revoked</Badge>;
  return hasConsent
    ? <Badge tone="success" className="gap-1"><ShieldCheck className="h-3 w-3" /> Consent on file</Badge>
    : <Badge tone="warning" className="gap-1"><ShieldAlert className="h-3 w-3" /> Consent missing</Badge>;
}

export function OverdueBadge() {
  return <Badge tone="danger" className="gap-1"><Clock className="h-3 w-3" /> Overdue</Badge>;
}

export function RatingStars({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-[12px] text-ink-tertiary">No rating</span>;
  return (
    <span className="inline-flex items-center gap-0.5" title={`${rating}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn("h-3.5 w-3.5", n <= rating ? "fill-brand-cream text-brand-cream" : "text-border-strong")} />
      ))}
    </span>
  );
}
