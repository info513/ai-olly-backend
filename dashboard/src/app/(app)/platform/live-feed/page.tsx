"use client";

import * as React from "react";
import Link from "next/link";
import { Rss, Plus, Search, AlertTriangle, Globe, Clock, MapPin, ArrowUpRight, Archive, Loader2, DownloadCloud, CheckCircle2 } from "lucide-react";
import { useFeedEvents, useImportFeedEvent, usePromoteFeedEvent, useArchiveExpiredFeed, feedDedupKey, isEventEnded, type FeedFilters } from "@/data/platform-livefeed";
import { useSetEventArchived } from "@/data/platform-events";
import { StatusBadge } from "@/components/platform/destination-status-badge";
import { usePlatform } from "@/providers/platform-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogClose } from "@/components/ui/dialog";

const SELECT_CLS = "appearance-none rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-1.5 text-[13px] text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2";
const LABEL = "block text-[12px] font-medium text-ink-secondary";
const slugify = (s: string) => s.toLowerCase().trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const fmt = (s: string | null, allDay: boolean) => { if (!s) return null; const d = new Date(s); return allDay ? d.toLocaleDateString() : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); };

export default function LiveFeedPage() {
  const { currentDestination, loading: destLoading } = usePlatform();
  const [search, setSearch] = React.useState("");
  const [state, setState] = React.useState<"all" | "current" | "expired">("all");
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const filters: FeedFilters = { search, state, includeArchived };
  const { data: rows, isLoading, isError, error, refetch } = useFeedEvents(currentDestination?.id, filters);
  const promote = usePromoteFeedEvent();
  const archive = useSetEventArchived();
  const expire = useArchiveExpiredFeed();
  const [msg, setMsg] = React.useState<string | null>(null);
  const expiredCount = (rows ?? []).filter((e) => isEventEnded(e) && e.status !== "archived").length;

  if (!destLoading && !currentDestination) return (
    <div className="mx-auto max-w-3xl p-6"><div className="rounded-xl border border-border-subtle bg-surface-raised p-10 text-center"><Globe className="mx-auto h-7 w-7 text-ink-tertiary" /><p className="mt-3 text-sm font-medium text-ink-secondary">No destination selected.</p><Button asChild variant="secondary" size="sm" className="mt-4"><Link href="/platform/destinations">Go to Destinations</Link></Button></div></div>
  );

  async function runExpiry() { if (!currentDestination) return; setMsg(null); try { const n = await expire.mutateAsync(currentDestination.id); setMsg(`Auto-expiry archived ${n} ended feed item(s).`); } catch (e: any) { setMsg(e?.message ?? "Auto-expiry failed."); } }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold text-ink-primary">Live Feed</h1><p className="mt-1 text-sm text-ink-tertiary">Time-sensitive feed items for <span className="font-medium text-ink-secondary">{currentDestination?.name ?? "…"}</span> — imported with dedup + auto-expiry. Each is an event; publish/edit in the Events editor.</p></div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={runExpiry} disabled={!currentDestination || expire.isPending}>{expire.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />} Archive expired{expiredCount > 0 ? ` (${expiredCount})` : ""}</Button>
          <ImportDialog destinationId={currentDestination?.id} existingKeys={new Set((rows ?? []).map((r) => r.feed_dedup_key ?? ""))} />
        </div>
      </header>
      {msg && <p className="rounded-md bg-success-soft/50 px-3 py-2 text-[13px] text-success">{msg}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, key, source…" className="pl-8" aria-label="Search feed" /></div>
        <select aria-label="State" className={SELECT_CLS} value={state} onChange={(e) => setState(e.target.value as any)}><option value="all">All items</option><option value="current">Current</option><option value="expired">Expired</option></select>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-secondary"><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="h-3.5 w-3.5 rounded border-border-strong" /> Include archived</label>
      </div>

      {isError ? (
        <div className="rounded-xl border border-danger/30 bg-danger-soft/40 p-6 text-center"><AlertTriangle className="mx-auto h-6 w-6 text-danger" /><p className="mt-2 text-sm text-ink-secondary">Couldn’t load the feed. {(error as any)?.message}</p><Button variant="secondary" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button></div>
      ) : isLoading || destLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[60px] w-full rounded-lg" />)}</div>
      ) : (rows ?? []).length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-10 text-center"><Rss className="mx-auto h-7 w-7 text-ink-tertiary" /><p className="mt-3 text-sm font-medium text-ink-secondary">No feed items yet.</p><p className="mt-1 text-[13px] text-ink-tertiary">Import a time-sensitive item to get started.</p></div>
      ) : (
        <ul className="space-y-2">{(rows ?? []).map((e) => (
          <li key={e.id}><div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border-subtle px-4 py-3">
            <Link href={`/platform/events/${e.id}`} className="flex min-w-0 flex-1 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-navy/50 text-brand-cream"><Rss className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink-primary">{e.title}{isEventEnded(e) && <span className="ml-2 rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">expired</span>}</span><span className="block truncate text-[12px] text-ink-tertiary">{[fmt(e.starts_at, e.all_day), e.location_name, e.feed_source && `via ${e.feed_source}`].filter(Boolean).join(" · ")}</span></span>
            </Link>
            <StatusBadge status={e.status} />
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" title="Promote to curated event" disabled={promote.isPending} onClick={async () => { await promote.mutateAsync(e.id); }}><ArrowUpRight className="h-4 w-4" /> Promote</Button>
              {e.status !== "archived" && <Button variant="ghost" size="sm" title="Archive" disabled={archive.isPending} onClick={async () => { await archive.mutateAsync({ id: e.id, archived: true }); }}><Archive className="h-4 w-4" /></Button>}
            </div>
          </div></li>
        ))}</ul>
      )}
    </div>
  );
}

function ImportDialog({ destinationId, existingKeys }: { destinationId?: string; existingKeys: Set<string> }) {
  const imp = useImportFeedEvent();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [source, setSource] = React.useState("");
  const [starts, setStarts] = React.useState("");
  const [ends, setEnds] = React.useState("");
  const [allDay, setAllDay] = React.useState(false);
  const [location, setLocation] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);

  const dupKey = title.trim() ? feedDedupKey(title, starts ? new Date(starts).toISOString() : null) : "";
  const isDup = !!dupKey && existingKeys.has(dupKey);
  const canImport = !!destinationId && title.trim().length >= 2 && source.trim().length >= 1 && !isDup;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!destinationId) return;
    try {
      await imp.mutateAsync({ destination_id: destinationId, key: `feed-${slugify(title)}-${Date.now().toString(36)}`, title: title.trim(), feed_source: source.trim(), starts_at: starts ? new Date(starts).toISOString() : null, ends_at: ends ? new Date(ends).toISOString() : null, all_day: allDay, location_name: location.trim() || null, short_description: null });
      setOpen(false); setTitle(""); setSource(""); setStarts(""); setEnds(""); setAllDay(false); setLocation("");
    } catch (e: any) { setErr(e?.code === "23505" ? "This item is already in the feed (dedup)." : (e?.message ?? "Import failed.")); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="primary" size="sm" disabled={!destinationId}><DownloadCloud className="h-4 w-4" /> Import item</Button></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Import feed item</DialogTitle><DialogDescription>Manually add a time-sensitive item. Duplicates (same title + date) are blocked. It’s created as a draft event — publish it in the Events editor.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1"><label className={LABEL}>Title</label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Street food night" autoFocus /></div>
          <div className="space-y-1"><label className={LABEL}>Feed source</label><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. City events feed" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><label className={LABEL}>Starts</label><Input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} /></div>
            <div className="space-y-1"><label className={LABEL}>Ends</label><Input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} /></div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-[13px] text-ink-secondary"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4 rounded border-border-strong" /> All-day</label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (optional)" className="h-8 flex-1" />
          </div>
          {isDup && <p className="inline-flex items-center gap-1.5 rounded-md bg-warning-soft/40 px-3 py-2 text-[12px] text-warning"><AlertTriangle className="h-3.5 w-3.5" /> A feed item with this title + date already exists.</p>}
          {!isDup && dupKey && <p className="inline-flex items-center gap-1.5 text-[12px] text-success"><CheckCircle2 className="h-3.5 w-3.5" /> No duplicate detected.</p>}
          {err && <p className="rounded-md bg-danger-soft/50 px-3 py-2 text-[13px] text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1"><DialogClose asChild><Button type="button" variant="ghost" size="sm">Cancel</Button></DialogClose><Button type="submit" variant="primary" size="sm" disabled={!canImport || imp.isPending}>{imp.isPending && <Loader2 className="h-4 w-4 animate-spin" />}<Plus className="h-4 w-4" /> Import</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
