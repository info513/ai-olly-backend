"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarDays, Plus, Search, AlertTriangle, Globe, MapPin, Clock } from "lucide-react";
import { useEvents, isEventEnded, type EventFilters, type ContentStatus, type VerificationStatus } from "@/data/platform-events";
import { StatusBadge, VerificationBadge } from "@/components/platform/destination-status-badge";
import { usePlatform } from "@/providers/platform-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const SELECT_CLS = "appearance-none rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-1.5 text-[13px] text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2";
const fmt = (s: string | null, allDay: boolean) => { if (!s) return null; const d = new Date(s); return allDay ? d.toLocaleDateString() : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); };

export default function EventsListPage() {
  const { currentDestination, loading: destLoading } = usePlatform();
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<ContentStatus | "all">("all");
  const [timeframe, setTimeframe] = React.useState<"all" | "upcoming" | "past">("all");
  const [verification, setVerification] = React.useState<VerificationStatus | "all">("all");
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const filters: EventFilters = { search, status, timeframe, verification, includeArchived };
  const { data: rows, isLoading, isError, error, refetch } = useEvents(currentDestination?.id, filters);
  const activeFilters = status !== "all" || timeframe !== "all" || verification !== "all" || includeArchived || !!search.trim();

  if (!destLoading && !currentDestination) return (
    <div className="mx-auto max-w-3xl p-6"><div className="rounded-xl border border-border-subtle bg-surface-raised p-10 text-center"><Globe className="mx-auto h-7 w-7 text-ink-tertiary" /><p className="mt-3 text-sm font-medium text-ink-secondary">No destination selected.</p><Button asChild variant="secondary" size="sm" className="mt-4"><Link href="/platform/destinations">Go to Destinations</Link></Button></div></div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold text-ink-primary">Events</h1><p className="mt-1 text-sm text-ink-tertiary">Canonical events for <span className="font-medium text-ink-secondary">{currentDestination?.name ?? "…"}</span>. Hotels read published, non-expired events; they never edit canonical facts.</p></div>
        <Button asChild variant="primary" size="sm" disabled={!currentDestination}><Link href="/platform/events/new"><Plus className="h-4 w-4" /> New event</Link></Button>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, key, location…" className="pl-8" aria-label="Search events" /></div>
        <select aria-label="Timeframe" className={SELECT_CLS} value={timeframe} onChange={(e) => setTimeframe(e.target.value as any)}><option value="all">All dates</option><option value="upcoming">Upcoming</option><option value="past">Past</option></select>
        <select aria-label="Status" className={SELECT_CLS} value={status} onChange={(e) => setStatus(e.target.value as any)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select>
        <select aria-label="Verification" className={SELECT_CLS} value={verification} onChange={(e) => setVerification(e.target.value as any)}><option value="all">Any verification</option><option value="unverified">Unverified</option><option value="verified">Verified</option><option value="stale">Stale</option></select>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-secondary"><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="h-3.5 w-3.5 rounded border-border-strong" /> Include archived</label>
      </div>
      {isError ? (
        <div className="rounded-xl border border-danger/30 bg-danger-soft/40 p-6 text-center"><AlertTriangle className="mx-auto h-6 w-6 text-danger" /><p className="mt-2 text-sm text-ink-secondary">Couldn’t load events. {(error as any)?.message}</p><Button variant="secondary" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button></div>
      ) : isLoading || destLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[64px] w-full rounded-lg" />)}</div>
      ) : (rows ?? []).length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-10 text-center"><CalendarDays className="mx-auto h-7 w-7 text-ink-tertiary" /><p className="mt-3 text-sm font-medium text-ink-secondary">{activeFilters ? "No events match these filters." : "No events in this destination yet."}</p>{!activeFilters && <Button asChild variant="primary" size="sm" className="mt-4"><Link href="/platform/events/new"><Plus className="h-4 w-4" /> Create the first event</Link></Button>}</div>
      ) : (
        <ul className="space-y-2">{(rows ?? []).map((e) => (
          <li key={e.id}><Link href={`/platform/events/${e.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border-subtle px-4 py-3 transition hover:bg-surface-hover">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-navy/50 text-brand-cream"><CalendarDays className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink-primary">{e.title}{isEventEnded(e) && <span className="ml-2 rounded bg-surface-overlay px-1.5 py-0.5 text-[10px] font-medium text-ink-tertiary">ended</span>}</span><span className="block truncate text-[12px] text-ink-tertiary">{[e.key, e.location_name].filter(Boolean).join(" · ")}</span></span>
            <div className="hidden items-center gap-3 text-[12px] text-ink-tertiary sm:flex">{fmt(e.starts_at, e.all_day) && <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{fmt(e.starts_at, e.all_day)}</span>}{e.location_name && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{e.location_name}</span>}</div>
            <div className="flex items-center gap-2"><VerificationBadge status={e.verification_status} /><StatusBadge status={e.status} /></div>
          </Link></li>
        ))}</ul>
      )}
    </div>
  );
}
