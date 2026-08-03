"use client";

import * as React from "react";
import Link from "next/link";
import { Star, MessageSquare } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useFeedback, useUpdateFeedback } from "@/data/feedback";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { FeedbackStatusPill, RatingStars } from "@/components/reception/rec-pills";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { relativeTime, cn } from "@/lib/utils";
import type { FeedbackStatus, FeedbackSummary } from "@/data/reception-types";

const FILTERS: [string, string][] = [["all", "All"], ["new", "New"], ["reviewed", "Reviewed"], ["resolved", "Resolved"], ["followup", "Needs follow-up"]];

export default function FeedbackPage() {
  const { currentHotel } = useHotel();
  const q = useFeedback(currentHotel?.id);
  const update = useUpdateFeedback(currentHotel?.id);
  const [filter, setFilter] = React.useState("all");
  const [err, setErr] = React.useState<string | null>(null);

  const items = React.useMemo(() => {
    let list = q.data ?? [];
    if (filter === "followup") list = list.filter((f) => f.followUpRequested && f.status !== "resolved");
    else if (filter !== "all") list = list.filter((f) => f.status === filter);
    return list;
  }, [q.data, filter]);

  const run = async (p: Promise<unknown>) => { setErr(null); try { await p; } catch (e) { setErr(humanizeError(e)); } };

  return (
    <div className="mx-auto max-w-[1000px] p-6">
      <PageHeader crumbs={[{ label: "Reception", href: "/reception" }, { label: "Feedback" }]} title="Feedback" subtitle="Guest ratings and comments for your hotel. Follow up where a guest asked." />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)} className={cn("rounded-full border px-3 py-1 text-[12px] transition-colors", filter === f ? "border-brand-goldDeep/50 bg-surface-base text-ink-primary" : "border-border-subtle text-ink-tertiary hover:text-ink-secondary")}>{label}</button>
        ))}
      </div>

      {err && <p className="mb-4 text-[12px] text-danger">{err}</p>}

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <SectionLoader rows={4} />
        : items.length === 0 ? <EmptyState icon={MessageSquare} title={(q.data ?? []).length ? "Nothing in this filter" : "No feedback yet"} hint="Guest feedback will appear here after stays." />
        : <div className="space-y-3">{items.map((f) => <Row key={f.id} f={f} onStatus={(s) => run(update.mutateAsync({ id: f.id, patch: { status: s } }))} pending={update.isPending} />)}</div>}
    </div>
  );
}

function Row({ f, onStatus, pending }: { f: FeedbackSummary; onStatus: (s: FeedbackStatus) => void; pending: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <RatingStars rating={f.rating} />
            <span className="text-[13px] font-medium text-ink-primary">{f.category ?? "General"}</span>
            {f.followUpRequested && <span className="rounded bg-warning-soft/50 px-1.5 py-0.5 text-[10px] font-medium text-warning">Follow-up requested</span>}
          </div>
          {f.message && <p className="mt-2 text-[13px] text-ink-secondary">{f.message}</p>}
          <div className="mt-2 text-[12px] text-ink-tertiary">{f.roomNumber ? `Room ${f.roomNumber} · ` : ""}{relativeTime(f.createdAt)}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <FeedbackStatusPill status={f.status} />
          <div className="flex gap-1.5">
            {f.status === "new" && <Button variant="ghost" size="sm" onClick={() => onStatus("reviewed")} loading={pending}>Mark reviewed</Button>}
            {f.status !== "resolved" && <Button variant="secondary" size="sm" onClick={() => onStatus("resolved")} loading={pending}>Resolve</Button>}
          </div>
        </div>
      </div>
      {f.stayId && <Link href={`/stays/${f.stayId}`} className="mt-2 inline-block text-[12px] text-ink-tertiary hover:text-ink-secondary">Open related stay →</Link>}
    </Card>
  );
}
