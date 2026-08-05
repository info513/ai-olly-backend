"use client";

import * as React from "react";
import Link from "next/link";
import { MapPin, Plus, Search, Landmark, Route, Sparkles, CalendarDays, Building2, AlertTriangle } from "lucide-react";
import { useDestinationList, DESTINATION_TYPES, type DestinationFilters, type ContentStatus, type DestinationType, type VerificationStatus } from "@/data/platform-destinations";
import { StatusBadge, VerificationBadge } from "@/components/platform/destination-status-badge";
import { usePlatform } from "@/providers/platform-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const SELECT_CLS =
  "appearance-none rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-1.5 text-[13px] text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2";

export default function DestinationsListPage() {
  const { setDestination, currentDestination } = usePlatform();
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<ContentStatus | "all">("all");
  const [type, setType] = React.useState<DestinationType | "all">("all");
  const [verification, setVerification] = React.useState<VerificationStatus | "all">("all");
  const [includeArchived, setIncludeArchived] = React.useState(false);

  const filters: DestinationFilters = { search, status, type, verification, includeArchived };
  const { data: rows, isLoading, isError, error, refetch } = useDestinationList(filters);

  const activeFilters = status !== "all" || type !== "all" || verification !== "all" || includeArchived || !!search.trim();

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Destinations</h1>
          <p className="mt-1 text-sm text-ink-tertiary">
            Canonical destinations maintained by AI OLLY Platform. Create, edit, and publish — hotels read published content.
          </p>
        </div>
        <Button asChild variant="primary" size="sm">
          <Link href="/platform/destinations/new"><Plus className="h-4 w-4" /> New destination</Link>
        </Button>
      </header>

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, slug, country…" className="pl-8" aria-label="Search destinations" />
        </div>
        <select aria-label="Filter by status" className={SELECT_CLS} value={status} onChange={(e) => setStatus(e.target.value as any)}>
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
        <select aria-label="Filter by type" className={SELECT_CLS} value={type} onChange={(e) => setType(e.target.value as any)}>
          <option value="all">All types</option>
          {DESTINATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select aria-label="Filter by verification" className={SELECT_CLS} value={verification} onChange={(e) => setVerification(e.target.value as any)}>
          <option value="all">Any verification</option>
          <option value="unverified">Unverified</option>
          <option value="verified">Verified</option>
          <option value="stale">Stale</option>
        </select>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="h-3.5 w-3.5 rounded border-border-strong" />
          Include archived
        </label>
      </div>

      {/* States */}
      {isError ? (
        <div className="rounded-xl border border-danger/30 bg-danger-soft/40 p-6 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-danger" />
          <p className="mt-2 text-sm text-ink-secondary">Couldn’t load destinations. {(error as any)?.message}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button>
        </div>
      ) : isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[68px] w-full rounded-lg" />)}</div>
      ) : (rows ?? []).length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-10 text-center">
          <MapPin className="mx-auto h-7 w-7 text-ink-tertiary" />
          <p className="mt-3 text-sm font-medium text-ink-secondary">{activeFilters ? "No destinations match these filters." : "No destinations yet."}</p>
          {!activeFilters && (
            <Button asChild variant="primary" size="sm" className="mt-4"><Link href="/platform/destinations/new"><Plus className="h-4 w-4" /> Create the first destination</Link></Button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {(rows ?? []).map((d) => {
            const active = d.id === currentDestination?.id;
            return (
              <li key={d.id}>
                <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 transition ${active ? "border-emerald-500/40 bg-emerald-500/5" : "border-border-subtle hover:bg-surface-hover"}`}>
                  <Link href={`/platform/destinations/${d.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-navy/50 text-brand-cream"><MapPin className="h-4 w-4" /></span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink-primary">{d.name}</span>
                      <span className="block truncate text-[12px] text-ink-tertiary">
                        {[d.country_code, DESTINATION_TYPES.find((t) => t.value === d.destination_type)?.label, d.default_locale, `updated ${new Date(d.updated_at).toLocaleDateString()}`].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </Link>
                  <div className="hidden items-center gap-3 text-[12px] text-ink-tertiary sm:flex" title="content counts">
                    <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{d.hotelCount}</span>
                    <span className="inline-flex items-center gap-1"><Landmark className="h-3.5 w-3.5" />{d.poiCount}</span>
                    <span className="inline-flex items-center gap-1"><Route className="h-3.5 w-3.5" />{d.routeCount}</span>
                    <span className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" />{d.whisperCount}</span>
                    <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{d.eventCount}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <VerificationBadge status={d.verification_status} />
                    <StatusBadge status={d.status} />
                    {d.status !== "archived" && (
                      <Button variant={active ? "secondary" : "ghost"} size="sm" onClick={() => setDestination(d.id)} disabled={active}>
                        {active ? "Current" : "Set context"}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
