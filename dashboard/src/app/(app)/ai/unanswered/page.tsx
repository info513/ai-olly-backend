"use client";

import * as React from "react";
import Link from "next/link";
import { MessageSquareWarning, ChevronDown, PlayCircle, Check } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useUnanswered, useUpdateUnanswered } from "@/data/unanswered";
import { useKnowledgeArticles } from "@/data/knowledge";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { relativeTime, cn } from "@/lib/utils";
import type { UnansweredQuestion } from "@/data/ai-types";

const STATUSES = ["open", "reviewing", "resolved", "dismissed"] as const;
const STATUS_TONE: Record<string, "warning" | "info" | "success" | "neutral"> = { open: "warning", reviewing: "info", resolved: "success", dismissed: "neutral" };

export default function UnansweredPage() {
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const listQ = useUnanswered(currentHotel?.id);
  const [filter, setFilter] = React.useState<string>("open");

  // unanswered_questions RLS permits writes by hotel_admin/editor (+platform_admin);
  // reception reviews read-only. Match the DB so we never offer a failing action.
  const canManage = role === "platform_admin" || role === "hotel_admin" || role === "editor";

  const items = React.useMemo(() => {
    const list = listQ.data ?? [];
    return filter === "all" ? list : list.filter((u) => u.status === filter);
  }, [listQ.data, filter]);

  const counts = React.useMemo(() => {
    const c: Record<string, number> = {};
    for (const u of listQ.data ?? []) c[u.status] = (c[u.status] ?? 0) + 1;
    return c;
  }, [listQ.data]);

  return (
    <div className="mx-auto max-w-[1000px] p-6">
      <PageHeader
        crumbs={[{ label: "AI", href: "/ai" }, { label: "Unanswered" }]}
        title="Questions Olly couldn't answer"
        subtitle="Guest questions Olly couldn't answer, grouped and de-duplicated. Turn each gap into a published answer."
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {(["open", "reviewing", "resolved", "dismissed", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("rounded-full border px-3 py-1 text-[12px] capitalize transition-colors", filter === f ? "border-brand-goldDeep/50 bg-surface-base text-ink-primary" : "border-border-subtle text-ink-tertiary hover:text-ink-secondary")}>
            {f}{f !== "all" && counts[f] ? ` · ${counts[f]}` : ""}
          </button>
        ))}
      </div>

      {listQ.isError ? (
        <ErrorState error={listQ.error} onRetry={() => listQ.refetch()} />
      ) : listQ.isLoading ? (
        <SectionLoader rows={5} />
      ) : items.length === 0 ? (
        <EmptyState icon={MessageSquareWarning} title={filter === "open" ? "No open questions — nice." : "Nothing here"} hint={filter === "open" ? "When the AI can't answer something, it shows up here to be turned into knowledge." : "Try another filter."} />
      ) : (
        <div className="space-y-2.5">
          {items.map((u) => <QuestionRow key={u.id} u={u} hotelId={currentHotel?.id} canManage={canManage} />)}
        </div>
      )}
    </div>
  );
}

function QuestionRow({ u, hotelId, canManage }: { u: UnansweredQuestion; hotelId?: string; canManage: boolean }) {
  const [open, setOpen] = React.useState(false);
  const update = useUpdateUnanswered(hotelId);
  const articlesQ = useKnowledgeArticles(hotelId);
  const [notes, setNotes] = React.useState(u.notes ?? "");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { setNotes(u.notes ?? ""); }, [u.notes]);

  const hotelArticles = (articlesQ.data ?? []).filter((a) => a.hotel_id === hotelId);
  const linked = hotelArticles.find((a) => a.id === u.resolution_article_id);

  const patch = async (p: Partial<UnansweredQuestion>) => {
    setError(null);
    try { await update.mutateAsync({ id: u.id, patch: p }); }
    catch (e) { setError(humanizeError(e)); }
  };

  return (
    <Card className="p-0">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] text-ink-primary">{u.normalized_question}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-tertiary">
            <span>asked {u.occurrence_count}×</span><span>·</span>
            <span>first {relativeTime(u.first_seen_at)}</span><span>·</span>
            <span>last {relativeTime(u.last_seen_at)}</span>
          </div>
        </div>
        <Badge tone={STATUS_TONE[u.status] ?? "neutral"} className="capitalize">{u.status}</Badge>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-tertiary transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="border-t border-border-subtle p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Status</label>
              <select value={u.status} disabled={!canManage} onChange={(e) => patch({ status: e.target.value })}
                className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm capitalize text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none disabled:opacity-50">
                {STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Resolution article</label>
              <select value={u.resolution_article_id ?? ""} disabled={!canManage} onChange={(e) => patch({ resolution_article_id: e.target.value || null })}
                className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none disabled:opacity-50">
                <option value="">Not linked</option>
                {hotelArticles.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-3">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Notes</label>
            <textarea value={notes} disabled={!canManage} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (u.notes ?? "") && patch({ notes: notes || null })} rows={2}
              className="w-full resize-y rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none disabled:opacity-50" placeholder="Context for whoever writes the answer…" />
          </div>

          {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {linked ? (
              <Link href={`/ai/knowledge/${linked.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-3 text-[12px] text-ink-secondary hover:text-ink-primary">Open linked article</Link>
            ) : canManage ? (
              <Link href="/ai/knowledge/new" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[12px] font-semibold text-brand-navy hover:bg-brand-creamSoft">Create answer</Link>
            ) : null}
            <Link href="/ai/preview" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-3 text-[12px] text-ink-secondary hover:text-ink-primary"><PlayCircle className="h-4 w-4" /> Test in Preview</Link>
            {canManage && u.status !== "resolved" && (
              <Button variant="secondary" size="sm" onClick={() => patch({ status: "resolved" })} loading={update.isPending}><Check className="h-4 w-4" /> Mark resolved</Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
