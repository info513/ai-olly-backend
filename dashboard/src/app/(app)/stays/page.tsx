"use client";

import * as React from "react";
import Link from "next/link";
import { Search, CalendarCheck, ChevronRight, X, Plus } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useStays } from "@/data/stays";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { StayStatusPill } from "@/components/reception/rec-pills";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StaySummary, StayStatus } from "@/data/reception-types";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");
type Filter = "current" | "reserved" | "checked_in" | "checked_out" | "cancelled" | "all";
const FILTERS: [Filter, string][] = [["current", "Current"], ["reserved", "Reserved"], ["checked_in", "In house"], ["checked_out", "Checked out"], ["cancelled", "Cancelled"], ["all", "All"]];

export default function StaysList() {
  const { currentHotel } = useHotel();
  const q = useStays(currentHotel?.id);
  const [filter, setFilter] = React.useState<Filter>("current");
  const [search, setSearch] = React.useState("");

  const items = React.useMemo(() => {
    let list = q.data ?? [];
    if (filter === "current") list = list.filter((s) => s.status === "reserved" || s.status === "checked_in");
    else if (filter !== "all") list = list.filter((s) => s.status === (filter as StayStatus));
    if (search.trim()) { const t = search.toLowerCase(); list = list.filter((s) => (s.guestName ?? "").toLowerCase().includes(t) || (s.roomNumber ?? "").includes(t)); }
    return list;
  }, [q.data, filter, search]);

  return (
    <div className="mx-auto max-w-[1100px] p-6">
      <PageHeader
        title="Stays"
        subtitle={`Reservations and in-house stays at ${currentHotel?.name ?? "your hotel"}.`}
        actions={<Link href="/stays/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[13px] font-semibold text-brand-navy hover:bg-brand-creamSoft"><Plus className="h-4 w-4" /> New stay</Link>}
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)} className={cn("rounded-full border px-3 py-1 text-[12px] transition-colors", filter === f ? "border-brand-goldDeep/50 bg-surface-base text-ink-primary" : "border-border-subtle text-ink-tertiary hover:text-ink-secondary")}>{label}</button>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search guest or room…" className="h-8 w-64 pl-8" /></div>
        {search && <button onClick={() => setSearch("")} className="flex items-center gap-1 text-[12px] text-ink-tertiary hover:text-ink-secondary"><X className="h-3.5 w-3.5" /> Clear</button>}
      </div>

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <SectionLoader rows={6} />
        : items.length === 0 ? <EmptyState icon={CalendarCheck} title={(q.data ?? []).length ? "No stays in this view" : "No stays yet"} hint={(q.data ?? []).length ? "Try another filter." : "Create a stay to check a guest in."} action={!(q.data ?? []).length && <Link href="/stays/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[13px] font-semibold text-brand-navy">New stay</Link>} />
        : <Card className="overflow-hidden p-0"><div className="divide-y divide-border-subtle">{items.map((s) => <Row key={s.id} s={s} />)}</div></Card>}
    </div>
  );
}

function Row({ s }: { s: StaySummary }) {
  return (
    <Link href={`/stays/${s.id}`} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-overlay/50">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-ink-primary">{s.guestName ?? "Unassigned guest"}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-tertiary"><span>Room {s.roomNumber ?? "—"}</span><span>·</span><span>{fmt(s.arrivalAt)} – {fmt(s.departureAt)}</span></div>
      </div>
      <StayStatusPill status={s.status} />
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
