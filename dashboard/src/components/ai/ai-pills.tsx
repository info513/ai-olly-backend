"use client";

import { AlertTriangle, Sparkles, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SCOPE_SHORT, SCOPE_LABEL, type KnowledgeScope } from "@/data/ai-types";

/** Human scope badge — never exposes UUIDs or "hotel_id NULL". */
export function ScopeBadge({ scope, full }: { scope: KnowledgeScope; full?: boolean }) {
  const tone = scope === "platform" ? "brand" : scope === "destination" ? "info" : "neutral";
  return <Badge tone={tone} title={SCOPE_LABEL[scope]}>{full ? SCOPE_LABEL[scope] : SCOPE_SHORT[scope]}</Badge>;
}

export function CriticalBadge() {
  return <Badge tone="danger" className="gap-1"><AlertTriangle className="h-3 w-3" /> Critical</Badge>;
}

export function AiChip({ on }: { on: boolean }) {
  return (
    <span
      title={on ? "Available to AI" : "Not available to AI"}
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
        on ? "border-transparent bg-brand-navySoft/40 text-brand-creamSoft" : "border-border-subtle text-ink-tertiary")}
    >
      <Sparkles className="h-3 w-3" /> AI
    </span>
  );
}

/** Validity chip — flags expired / not-yet-valid content the AI would exclude. */
export function ValidityChip({ from, to }: { from: string | null; to: string | null }) {
  const now = Date.now();
  const expired = to != null && new Date(to).getTime() < now;
  const future = from != null && new Date(from).getTime() > now;
  if (expired) return <Badge tone="danger" className="gap-1"><Clock className="h-3 w-3" /> Expired</Badge>;
  if (future) return <Badge tone="warning" className="gap-1"><Clock className="h-3 w-3" /> Not yet valid</Badge>;
  if (to) return <span className="text-[12px] text-ink-tertiary">until {new Date(to).toLocaleDateString()}</span>;
  return <span className="text-[12px] text-ink-tertiary">permanent</span>;
}
