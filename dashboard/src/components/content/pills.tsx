"use client";

import { AlertTriangle, Globe, Smartphone, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ContentStatus, ServiceSource } from "@/data/types";

const STATUS: Record<ContentStatus, { label: string; tone: "neutral" | "warning" | "success" | "info" }> = {
  draft: { label: "Draft", tone: "warning" },
  preview: { label: "Preview", tone: "info" },
  published: { label: "Live", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
};

export function StatusPill({ status }: { status: ContentStatus }) {
  const s = STATUS[status];
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

const SOURCE: Record<ServiceSource, string> = {
  platform: "Platform default",
  hotel: "Hotel service",
  override: "Hotel override",
};
export function SourceBadge({ source }: { source: ServiceSource }) {
  return <Badge tone={source === "platform" ? "brand" : "neutral"}>{SOURCE[source]}</Badge>;
}

export function CriticalBadge() {
  return (
    <Badge tone="danger" className="gap-1">
      <AlertTriangle className="h-3 w-3" /> Critical
    </Badge>
  );
}

/** Channel visibility chips — active channels highlighted, off ones muted. */
export function VisibilityChips({
  pwa,
  web,
  ai,
  className,
}: {
  pwa: boolean;
  web: boolean;
  ai: boolean;
  className?: string;
}) {
  const chip = (on: boolean, Icon: typeof Globe, label: string) => (
    <span
      title={`${label}: ${on ? "visible" : "hidden"}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
        on
          ? "border-transparent bg-brand-navySoft/40 text-brand-creamSoft"
          : "border-border-subtle text-ink-tertiary"
      )}
    >
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {chip(pwa, Smartphone, "PWA")}
      {chip(web, Globe, "Web")}
      {chip(ai, Sparkles, "AI")}
    </div>
  );
}
