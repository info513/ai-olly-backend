"use client";

import * as React from "react";
import Link from "next/link";
import { Landmark, Plus, Search, AlertTriangle, MapPin, Globe } from "lucide-react";
import { usePois, POI_CATEGORIES, type PoiFilters, type ContentStatus, type PoiCategory, type VerificationStatus } from "@/data/platform-pois";
import { StatusBadge, VerificationBadge } from "@/components/platform/destination-status-badge";
import { usePlatform } from "@/providers/platform-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const SELECT_CLS =
  "appearance-none rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-1.5 text-[13px] text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2";

export default function PoisListPage() {
  const { currentDestination, loading: destLoading } = usePlatform();
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<ContentStatus | "all">("all");
  const [category, setCategory] = React.useState<PoiCategory | "all">("all");
  const [verification, setVerification] = React.useState<VerificationStatus | "all">("all");
  const [includeArchived, setIncludeArchived] = React.useState(false);

  const filters: PoiFilters = { search, status, category, verification, includeArchived };
  const { data: rows, isLoading, isError, error, refetch } = usePois(currentDestination?.id, filters);
  const activeFilters = status !== "all" || category !== "all" || verification !== "all" || includeArchived || !!search.trim();

  if (!destLoading && !currentDestination) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-10 text-center">
          <Globe className="mx-auto h-7 w-7 text-ink-tertiary" />
          <p className="mt-3 text-sm font-medium text-ink-secondary">No destination selected.</p>
          <p className="mt-1 text-[13px] text-ink-tertiary">POIs are scoped to a destination. Choose one from the switcher, or</p>
          <Button asChild variant="secondary" size="sm" className="mt-4"><Link href="/platform/destinations">go to Destinations</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">POIs</h1>
          <p className="mt-1 text-sm text-ink-tertiary">
            Canonical points of interest for <span className="font-medium text-ink-secondary">{currentDestination?.name ?? "…"}</span>,
            maintained by AI OLLY Platform. Hotels read published POIs; they never edit canonical facts.
          </p>
        </div>
        <Button asChild variant="primary" size="sm" disabled={!currentDestination}>
          <Link href="/platform/pois/new"><Plus className="h-4 w-4" /> New POI</Link>
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, key, address…" className="pl-8" aria-label="Search POIs" />
        </div>
        <select aria-label="Filter by status" className={SELECT_CLS} value={status} onChange={(e) => setStatus(e.target.value as any)}>
          <option value="all">All statuses</option>
          <option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option>
        </select>
        <select aria-label="Filter by category" className={SELECT_CLS} value={category} onChange={(e) => setCategory(e.target.value as any)}>
          <option value="all">All categories</option>
          {POI_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select aria-label="Filter by verification" className={SELECT_CLS} value={verification} onChange={(e) => setVerification(e.target.value as any)}>
          <option value="all">Any verification</option>
          <option value="unverified">Unverified</option><option value="verified">Verified</option><option value="stale">Stale</option>
        </select>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="h-3.5 w-3.5 rounded border-border-strong" />
          Include archived
        </label>
      </div>

      {isError ? (
        <div className="rounded-xl border border-danger/30 bg-danger-soft/40 p-6 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-danger" />
          <p className="mt-2 text-sm text-ink-secondary">Couldn’t load POIs. {(error as any)?.message}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button>
        </div>
      ) : isLoading || destLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[64px] w-full rounded-lg" />)}</div>
      ) : (rows ?? []).length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-10 text-center">
          <Landmark className="mx-auto h-7 w-7 text-ink-tertiary" />
          <p className="mt-3 text-sm font-medium text-ink-secondary">{activeFilters ? "No POIs match these filters." : "No POIs in this destination yet."}</p>
          {!activeFilters && (
            <Button asChild variant="primary" size="sm" className="mt-4"><Link href="/platform/pois/new"><Plus className="h-4 w-4" /> Create the first POI</Link></Button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {(rows ?? []).map((p) => (
            <li key={p.id}>
              <Link href={`/platform/pois/${p.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border-subtle px-4 py-3 transition hover:bg-surface-hover">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-navy/50 text-brand-cream"><Landmark className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-primary">{p.name}</span>
                  <span className="block truncate text-[12px] text-ink-tertiary">
                    {[POI_CATEGORIES.find((c) => c.value === p.category)?.label, p.key, p.address].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {(p.latitude != null && p.longitude != null) && (
                  <span className="hidden items-center gap-1 text-[12px] text-ink-tertiary sm:flex"><MapPin className="h-3.5 w-3.5" />{Number(p.latitude).toFixed(2)}, {Number(p.longitude).toFixed(2)}</span>
                )}
                <div className="flex items-center gap-2">
                  <VerificationBadge status={p.verification_status} />
                  <StatusBadge status={p.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
