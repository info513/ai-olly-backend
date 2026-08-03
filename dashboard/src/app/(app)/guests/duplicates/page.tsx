"use client";

import * as React from "react";
import Link from "next/link";
import { Copy, Check, X, Clock, ArrowRight } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useDuplicateSuggestions, useReviewDuplicate } from "@/data/guests";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DuplicateSuggestion } from "@/data/reception-types";

const FILTERS: [string, string][] = [["pending", "To review"], ["confirmed", "Confirmed"], ["rejected", "Dismissed"], ["all", "All"]];

export default function DuplicatesPage() {
  const { currentHotel } = useHotel();
  const q = useDuplicateSuggestions(currentHotel?.id);
  const review = useReviewDuplicate(currentHotel?.id);
  const [filter, setFilter] = React.useState("pending");
  const [err, setErr] = React.useState<string | null>(null);

  const items = (q.data ?? []).filter((d) => filter === "all" || d.status === filter);
  const run = async (p: Promise<unknown>) => { setErr(null); try { await p; } catch (e) { setErr(humanizeError(e)); } };

  return (
    <div className="mx-auto max-w-[900px] p-6">
      <PageHeader
        crumbs={[{ label: "Guests", href: "/guests" }, { label: "Duplicates" }]}
        title="Possible duplicates"
        subtitle="Suggestions only — nothing is merged automatically. Review and record a decision."
      />

      <div className="mb-4 rounded-md border border-border-subtle bg-surface-base px-3 py-2 text-[12px] text-ink-tertiary">
        Confirming records that these are the same guest for your team. An automatic merge is intentionally not performed — the schema has no safe merge primitive, so no data is combined or deleted.
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)} className={cn("rounded-full border px-3 py-1 text-[12px] transition-colors", filter === f ? "border-brand-goldDeep/50 bg-surface-base text-ink-primary" : "border-border-subtle text-ink-tertiary hover:text-ink-secondary")}>{label}</button>
        ))}
      </div>

      {err && <p className="mb-4 text-[12px] text-danger">{err}</p>}

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <SectionLoader rows={3} />
        : items.length === 0 ? <EmptyState icon={Copy} title="Nothing to review" hint="Duplicate suggestions appear here when two guest records look alike." />
        : <div className="space-y-3">{items.map((d) => <DupCard key={d.id} d={d} onReview={(decision) => run(review.mutateAsync({ id: d.id, decision }))} pending={review.isPending} />)}</div>}
    </div>
  );
}

function DupCard({ d, onReview, pending }: { d: DuplicateSuggestion; onReview: (dec: "confirmed" | "rejected" | "pending") => void; pending: boolean }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] text-ink-tertiary">
          {d.matchScore != null && <Badge tone="warning">{Math.round(d.matchScore * 100)}% match</Badge>}
          {d.matchReason && <span>{d.matchReason}</span>}
        </div>
        {d.status !== "pending" && <Badge tone={d.status === "confirmed" ? "success" : "neutral"} className="capitalize">{d.status === "rejected" ? "Dismissed" : d.status}</Badge>}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <GuestCell name={d.guestName} id={d.guestId} />
        <ArrowRight className="h-4 w-4 text-ink-tertiary" />
        <GuestCell name={d.candidateName} id={d.candidateGuestId} align="right" />
      </div>
      {d.status === "pending" && (
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onReview("pending")} loading={pending}><Clock className="h-4 w-4" /> Defer</Button>
          <Button variant="ghost" size="sm" onClick={() => onReview("rejected")} loading={pending}><X className="h-4 w-4" /> Not a duplicate</Button>
          <Button variant="secondary" size="sm" onClick={() => onReview("confirmed")} loading={pending}><Check className="h-4 w-4" /> Confirm duplicate</Button>
        </div>
      )}
    </Card>
  );
}

function GuestCell({ name, id, align }: { name: string; id: string; align?: "right" }) {
  return (
    <Link href={`/guests/${id}`} className={cn("block rounded-md border border-border-subtle bg-surface-base px-3 py-2 hover:border-border-strong", align === "right" && "text-right")}>
      <div className="truncate text-[13px] font-medium text-ink-primary">{name}</div>
      <div className="text-[11px] text-ink-tertiary">Open profile →</div>
    </Link>
  );
}
