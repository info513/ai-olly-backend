"use client";

import * as React from "react";
import Link from "next/link";
import { Brain, Plus, Search, AlertTriangle, Globe, Sparkles, ShieldAlert } from "lucide-react";
import { useDestArticles, type ArticleFilters, type ContentStatus } from "@/data/platform-ai-knowledge";
import { StatusBadge } from "@/components/platform/destination-status-badge";
import { usePlatform } from "@/providers/platform-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const SELECT_CLS = "appearance-none rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-1.5 text-[13px] text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2";

export default function AiKnowledgeListPage() {
  const { currentDestination, loading: destLoading } = usePlatform();
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<ContentStatus | "all">("all");
  const [visibility, setVisibility] = React.useState<"all" | "ai" | "hidden">("all");
  const [critical, setCritical] = React.useState(false);
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const filters: ArticleFilters = { search, status, visibility, critical, includeArchived };
  const { data: rows, isLoading, isError, error, refetch } = useDestArticles(currentDestination?.id, filters);
  const activeFilters = status !== "all" || visibility !== "all" || critical || includeArchived || !!search.trim();

  if (!destLoading && !currentDestination) return (
    <div className="mx-auto max-w-3xl p-6"><div className="rounded-xl border border-border-subtle bg-surface-raised p-10 text-center"><Globe className="mx-auto h-7 w-7 text-ink-tertiary" /><p className="mt-3 text-sm font-medium text-ink-secondary">No destination selected.</p><Button asChild variant="secondary" size="sm" className="mt-4"><Link href="/platform/destinations">Go to Destinations</Link></Button></div></div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold text-ink-primary">Destination AI Knowledge</h1><p className="mt-1 text-sm text-ink-tertiary">Canonical destination-scope answers for <span className="font-medium text-ink-secondary">{currentDestination?.name ?? "…"}</span> — used by the AI at the destination scope (hotel &gt; destination &gt; platform). AI never invents; unknown → safe handoff.</p></div>
        <Button asChild variant="primary" size="sm" disabled={!currentDestination}><Link href="/platform/ai-knowledge/new"><Plus className="h-4 w-4" /> New article</Link></Button>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, key, answer…" className="pl-8" aria-label="Search AI knowledge" /></div>
        <select aria-label="Status" className={SELECT_CLS} value={status} onChange={(e) => setStatus(e.target.value as any)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select>
        <select aria-label="AI visibility" className={SELECT_CLS} value={visibility} onChange={(e) => setVisibility(e.target.value as any)}><option value="all">Any visibility</option><option value="ai">AI-visible</option><option value="hidden">Hidden from AI</option></select>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-secondary"><input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} className="h-3.5 w-3.5 rounded border-border-strong" /> Critical only</label>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-secondary"><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="h-3.5 w-3.5 rounded border-border-strong" /> Include archived</label>
      </div>
      {isError ? (
        <div className="rounded-xl border border-danger/30 bg-danger-soft/40 p-6 text-center"><AlertTriangle className="mx-auto h-6 w-6 text-danger" /><p className="mt-2 text-sm text-ink-secondary">Couldn’t load knowledge. {(error as any)?.message}</p><Button variant="secondary" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button></div>
      ) : isLoading || destLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[60px] w-full rounded-lg" />)}</div>
      ) : (rows ?? []).length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-10 text-center"><Brain className="mx-auto h-7 w-7 text-ink-tertiary" /><p className="mt-3 text-sm font-medium text-ink-secondary">{activeFilters ? "No articles match these filters." : "No destination knowledge yet."}</p>{!activeFilters && <Button asChild variant="primary" size="sm" className="mt-4"><Link href="/platform/ai-knowledge/new"><Plus className="h-4 w-4" /> Create the first article</Link></Button>}</div>
      ) : (
        <ul className="space-y-2">{(rows ?? []).map((a) => (
          <li key={a.id}><Link href={`/platform/ai-knowledge/${a.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border-subtle px-4 py-3 transition hover:bg-surface-hover">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-navy/50 text-brand-cream"><Brain className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink-primary">{a.title}</span><span className="block truncate text-[12px] text-ink-tertiary">{[a.key, a.approved_answer].filter(Boolean).join(" · ")}</span></span>
            <div className="flex items-center gap-2">
              {a.is_critical && <Badge tone="danger" dot>Critical</Badge>}
              {a.available_to_ai ? <Badge tone="success"><Sparkles className="h-3 w-3" /> AI</Badge> : <Badge tone="neutral">Hidden</Badge>}
              <span className="hidden text-[11px] text-ink-tertiary sm:inline">P{a.priority}</span>
              <StatusBadge status={a.status} />
            </div>
          </Link></li>
        ))}</ul>
      )}
    </div>
  );
}
