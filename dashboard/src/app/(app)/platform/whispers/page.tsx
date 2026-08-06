"use client";

import * as React from "react";
import Link from "next/link";
import { Sparkles, Plus, Search, AlertTriangle, Globe } from "lucide-react";
import { useWhispers, type WhisperFilters, type ContentStatus, type VerificationStatus } from "@/data/platform-whispers";
import { StatusBadge, VerificationBadge } from "@/components/platform/destination-status-badge";
import { usePlatform } from "@/providers/platform-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const SELECT_CLS = "appearance-none rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-1.5 text-[13px] text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2";

export default function WhispersListPage() {
  const { currentDestination, loading: destLoading } = usePlatform();
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<ContentStatus | "all">("all");
  const [channel, setChannel] = React.useState<string>("all");
  const [verification, setVerification] = React.useState<VerificationStatus | "all">("all");
  const [includeArchived, setIncludeArchived] = React.useState(false);

  const filters: WhisperFilters = { search, status, channel, verification, includeArchived };
  const { data: rows, isLoading, isError, error, refetch } = useWhispers(currentDestination?.id, filters);
  const channels = React.useMemo(() => Array.from(new Set((rows ?? []).map((w) => w.channel_key))).sort(), [rows]);
  const activeFilters = status !== "all" || channel !== "all" || verification !== "all" || includeArchived || !!search.trim();

  // group by channel
  const groups = React.useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const w of rows ?? []) { const k = w.channel_key || "—"; (m.get(k) ?? m.set(k, [] as any).get(k)!).push(w); }
    return [...m.entries()];
  }, [rows]);

  if (!destLoading && !currentDestination) {
    return (
      <div className="mx-auto max-w-3xl p-6"><div className="rounded-xl border border-border-subtle bg-surface-raised p-10 text-center">
        <Globe className="mx-auto h-7 w-7 text-ink-tertiary" /><p className="mt-3 text-sm font-medium text-ink-secondary">No destination selected.</p>
        <Button asChild variant="secondary" size="sm" className="mt-4"><Link href="/platform/destinations">Go to Destinations</Link></Button>
      </div></div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Whispers</h1>
          <p className="mt-1 text-sm text-ink-tertiary">Canonical story chapters for <span className="font-medium text-ink-secondary">{currentDestination?.name ?? "…"}</span>, grouped by channel. Hotels read published whispers; they never edit canonical facts.</p>
        </div>
        <Button asChild variant="primary" size="sm" disabled={!currentDestination}><Link href="/platform/whispers/new"><Plus className="h-4 w-4" /> New whisper</Link></Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, key, channel…" className="pl-8" aria-label="Search whispers" />
        </div>
        <select aria-label="Status" className={SELECT_CLS} value={status} onChange={(e) => setStatus(e.target.value as any)}>
          <option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option>
        </select>
        <select aria-label="Channel" className={SELECT_CLS} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="all">All channels</option>{channels.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Verification" className={SELECT_CLS} value={verification} onChange={(e) => setVerification(e.target.value as any)}>
          <option value="all">Any verification</option><option value="unverified">Unverified</option><option value="verified">Verified</option><option value="stale">Stale</option>
        </select>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-secondary"><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="h-3.5 w-3.5 rounded border-border-strong" /> Include archived</label>
      </div>

      {isError ? (
        <div className="rounded-xl border border-danger/30 bg-danger-soft/40 p-6 text-center"><AlertTriangle className="mx-auto h-6 w-6 text-danger" /><p className="mt-2 text-sm text-ink-secondary">Couldn’t load whispers. {(error as any)?.message}</p><Button variant="secondary" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button></div>
      ) : isLoading || destLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[56px] w-full rounded-lg" />)}</div>
      ) : (rows ?? []).length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-10 text-center"><Sparkles className="mx-auto h-7 w-7 text-ink-tertiary" /><p className="mt-3 text-sm font-medium text-ink-secondary">{activeFilters ? "No whispers match these filters." : "No whispers in this destination yet."}</p>{!activeFilters && <Button asChild variant="primary" size="sm" className="mt-4"><Link href="/platform/whispers/new"><Plus className="h-4 w-4" /> Create the first whisper</Link></Button>}</div>
      ) : (
        <div className="space-y-5">
          {groups.map(([ch, items]) => (
            <section key={ch}>
              <h2 className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-ink-tertiary"><Sparkles className="h-3.5 w-3.5" /> {ch} <span className="text-ink-tertiary/60">· {items!.length}</span></h2>
              <ul className="space-y-2">
                {items!.map((w) => (
                  <li key={w.id}>
                    <Link href={`/platform/whispers/${w.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border-subtle px-4 py-3 transition hover:bg-surface-hover">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-navy/50 text-[11px] font-semibold text-brand-cream">{w.sort_order}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink-primary">{w.title}</span><span className="block truncate text-[12px] text-ink-tertiary">{[w.key, w.short_description].filter(Boolean).join(" · ")}</span></span>
                      <div className="flex items-center gap-2"><VerificationBadge status={w.verification_status} /><StatusBadge status={w.status} /></div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
