"use client";

import * as React from "react";
import { Eye, Sparkles } from "lucide-react";
import { ScopeBadge, CriticalBadge } from "./ai-pills";
import { BlockView } from "@/components/content/block-view";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { useResolvedKnowledge } from "@/data/knowledge";
import { cn } from "@/lib/utils";

/**
 * Retrieval Preview (Part 9): what the AI actually receives — LIVE (published
 * snapshots) vs PREVIEW (includes the author's drafts). Override wins over its
 * platform/destination default; expired / hidden / not-available-to-AI excluded;
 * deduped by key. Dashboard-only; no production guest API is called.
 */
export function ResolvedKnowledgePanel({ hotelId, locale = "en" }: { hotelId?: string; locale?: string }) {
  const [preview, setPreview] = React.useState(false);
  const live = useResolvedKnowledge(hotelId, locale, false);
  const prev = useResolvedKnowledge(hotelId, locale, true);
  const q = preview ? prev : live;

  const liveKeys = new Set((live.data ?? []).map((r) => r.key));
  const draftOnly = new Set((prev.data ?? []).filter((r) => !liveKeys.has(r.key)).map((r) => r.key));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">
          <Eye className="h-4 w-4" /> Retrieval preview — what the AI receives
        </div>
        <div className="inline-flex rounded-md border border-border-strong bg-surface-sunken p-0.5">
          {([["Live", false], ["Preview (with drafts)", true]] as const).map(([label, v]) => (
            <button key={label} onClick={() => setPreview(v)}
              className={cn("rounded px-2.5 py-1 text-[12px] font-medium transition-colors",
                preview === v ? "bg-brand-navy text-brand-creamSoft" : "text-ink-tertiary hover:text-ink-secondary")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-3 rounded-md bg-surface-base px-3 py-2 text-[12px] text-ink-tertiary">
        {preview
          ? "Preview includes unpublished drafts (visible only to authors). Draft-only articles are marked — Live retrieval excludes them."
          : "Live is exactly what guests and the AI get right now — published snapshots only, overrides applied, expired and AI-hidden entries removed."}
      </p>

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <SectionLoader rows={4} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={Eye} title="Nothing resolved yet" hint="Published, active, in-validity, AI-available articles appear here." />
      ) : (
        <div className="space-y-3">
          {q.data!.map((r) => {
            const isDraftOnly = preview && draftOnly.has(r.key);
            return (
              <div key={r.article_id} className={cn("rounded-lg border p-4", isDraftOnly ? "border-info/40 bg-info-soft/20" : "border-border-subtle bg-surface-raised")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink-primary">{r.title}</span>
                      {r.is_critical && <CriticalBadge />}
                      {isDraftOnly && <span className="rounded bg-info-soft/60 px-1.5 py-0.5 text-[10px] font-medium text-info">Draft — not live</span>}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-ink-tertiary">{r.key}{r.priority ? ` · priority ${r.priority}` : ""}</div>
                  </div>
                  <ScopeBadge scope={r.source} />
                </div>
                {r.approved_answer && (
                  <div className="mt-2 flex items-start gap-2 rounded-md border border-brand-navySoft/40 bg-brand-navy/20 px-3 py-2 text-[13px] text-brand-creamSoft">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{r.approved_answer}</span>
                  </div>
                )}
                <div className="mt-3 rounded-md bg-surface-sunken p-3"><BlockView body={r.body_content} /></div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
