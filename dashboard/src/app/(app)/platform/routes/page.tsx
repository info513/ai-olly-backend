"use client";

import * as React from "react";
import Link from "next/link";
import { Route as RouteIcon, Plus, Search, AlertTriangle, Globe, MapPin, Clock, Gauge } from "lucide-react";
import { useRoutes, ROUTE_TYPES, ROUTE_DIFFICULTIES, readStops, type RouteFilters, type ContentStatus, type RouteType, type RouteDifficulty, type VerificationStatus } from "@/data/platform-routes";
import { StatusBadge, VerificationBadge } from "@/components/platform/destination-status-badge";
import { usePlatform } from "@/providers/platform-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const SELECT_CLS =
  "appearance-none rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-1.5 text-[13px] text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2";

export default function RoutesListPage() {
  const { currentDestination, loading: destLoading } = usePlatform();
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<ContentStatus | "all">("all");
  const [routeType, setRouteType] = React.useState<RouteType | "all">("all");
  const [difficulty, setDifficulty] = React.useState<RouteDifficulty | "all">("all");
  const [verification, setVerification] = React.useState<VerificationStatus | "all">("all");
  const [includeArchived, setIncludeArchived] = React.useState(false);

  const filters: RouteFilters = { search, status, routeType, difficulty, verification, includeArchived };
  const { data: rows, isLoading, isError, error, refetch } = useRoutes(currentDestination?.id, filters);
  const activeFilters = status !== "all" || routeType !== "all" || difficulty !== "all" || verification !== "all" || includeArchived || !!search.trim();

  if (!destLoading && !currentDestination) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-10 text-center">
          <Globe className="mx-auto h-7 w-7 text-ink-tertiary" />
          <p className="mt-3 text-sm font-medium text-ink-secondary">No destination selected.</p>
          <p className="mt-1 text-[13px] text-ink-tertiary">Routes are scoped to a destination. Choose one from the switcher, or</p>
          <Button asChild variant="secondary" size="sm" className="mt-4"><Link href="/platform/destinations">go to Destinations</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Routes</h1>
          <p className="mt-1 text-sm text-ink-tertiary">
            Canonical routes for <span className="font-medium text-ink-secondary">{currentDestination?.name ?? "…"}</span>,
            maintained by AI OLLY Platform. Hotels read published routes; they never edit canonical facts.
          </p>
        </div>
        <Button asChild variant="primary" size="sm" disabled={!currentDestination}>
          <Link href="/platform/routes/new"><Plus className="h-4 w-4" /> New route</Link>
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, key, start/end…" className="pl-8" aria-label="Search routes" />
        </div>
        <select aria-label="Filter by status" className={SELECT_CLS} value={status} onChange={(e) => setStatus(e.target.value as any)}>
          <option value="all">All statuses</option>
          <option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option>
        </select>
        <select aria-label="Filter by type" className={SELECT_CLS} value={routeType} onChange={(e) => setRouteType(e.target.value as any)}>
          <option value="all">All types</option>
          {ROUTE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select aria-label="Filter by difficulty" className={SELECT_CLS} value={difficulty} onChange={(e) => setDifficulty(e.target.value as any)}>
          <option value="all">Any difficulty</option>
          {ROUTE_DIFFICULTIES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
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
          <p className="mt-2 text-sm text-ink-secondary">Couldn’t load routes. {(error as any)?.message}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button>
        </div>
      ) : isLoading || destLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[64px] w-full rounded-lg" />)}</div>
      ) : (rows ?? []).length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-10 text-center">
          <RouteIcon className="mx-auto h-7 w-7 text-ink-tertiary" />
          <p className="mt-3 text-sm font-medium text-ink-secondary">{activeFilters ? "No routes match these filters." : "No routes in this destination yet."}</p>
          {!activeFilters && (
            <Button asChild variant="primary" size="sm" className="mt-4"><Link href="/platform/routes/new"><Plus className="h-4 w-4" /> Create the first route</Link></Button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {(rows ?? []).map((r) => {
            const stopCount = readStops(r.waypoints).length || (r.waypoints?.order?.length ?? r.waypoints?.pois?.length ?? 0);
            return (
              <li key={r.id}>
                <Link href={`/platform/routes/${r.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border-subtle px-4 py-3 transition hover:bg-surface-hover">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-navy/50 text-brand-cream"><RouteIcon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-primary">{r.name}</span>
                    <span className="block truncate text-[12px] text-ink-tertiary">
                      {[ROUTE_TYPES.find((t) => t.value === r.route_type)?.label, r.key, `${stopCount} stop${stopCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <div className="hidden items-center gap-3 text-[12px] text-ink-tertiary sm:flex">
                    {r.difficulty && <span className="inline-flex items-center gap-1"><Gauge className="h-3.5 w-3.5" />{ROUTE_DIFFICULTIES.find((d) => d.value === r.difficulty)?.label}</span>}
                    {r.distance_km != null && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{r.distance_km} km</span>}
                    {r.duration_minutes != null && <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{r.duration_minutes} min</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <VerificationBadge status={r.verification_status} />
                    <StatusBadge status={r.status} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
