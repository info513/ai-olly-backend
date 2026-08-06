"use client";

import * as React from "react";
import { ChevronUp, ChevronDown, X, Plus, Search, Landmark, GripVertical } from "lucide-react";
import { POI_CATEGORIES, type Waypoint, type Poi } from "@/data/platform-routes";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const catLabel = (c?: string) => POI_CATEGORIES.find((x) => x.value === c)?.label ?? c ?? "";

/** Ordered POI-waypoint editor. Stores structured stops ({poi_id, poi_key, note}),
 *  never free text. The picker is scoped to the route's destination POIs, so a
 *  cross-destination POI can never be added. */
export function RouteWaypointEditor({
  stops, pois, onChange, disabled,
}: { stops: Waypoint[]; pois: Poi[]; onChange: (s: Waypoint[]) => void; disabled?: boolean }) {
  const [query, setQuery] = React.useState("");
  const byId = React.useMemo(() => new Map(pois.map((p) => [p.id, p])), [pois]);
  const usedIds = new Set(stops.map((s) => s.poi_id));

  const available = pois.filter((p) => !usedIds.has(p.id) && (
    !query.trim() || [p.name, p.key].some((v) => v?.toLowerCase().includes(query.trim().toLowerCase()))
  ));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    const next = [...stops];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i: number) => onChange(stops.filter((_, j) => j !== i));
  const setNote = (i: number, note: string) => onChange(stops.map((s, j) => (j === i ? { ...s, note } : s)));
  const add = (p: Poi) => { onChange([...stops, { poi_id: p.id, poi_key: p.key, note: null }]); setQuery(""); };

  return (
    <div className="space-y-3">
      {/* Ordered stops */}
      {stops.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-strong bg-surface-sunken px-3 py-4 text-center text-[13px] text-ink-tertiary">
          No stops yet. Add POIs below to build the route.
        </p>
      ) : (
        <ol className="space-y-2">
          {stops.map((s, i) => {
            const poi = byId.get(s.poi_id);
            return (
              <li key={s.poi_id} className="rounded-lg border border-border-subtle bg-surface-sunken p-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-navy/60 text-[12px] font-semibold text-brand-cream">{i + 1}</span>
                  <GripVertical className="h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink-primary">{poi?.name ?? s.poi_key ?? "Unknown POI"}</span>
                    <span className="block text-[11px] text-ink-tertiary">{poi ? [catLabel(poi.category), poi.key].filter(Boolean).join(" · ") : (s.poi_key ?? "not in this destination")}</span>
                  </span>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="Move up"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary hover:bg-surface-overlay hover:text-ink-primary disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
                    <button type="button" disabled={disabled || i === stops.length - 1} onClick={() => move(i, 1)} aria-label="Move down"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary hover:bg-surface-overlay hover:text-ink-primary disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
                    <button type="button" disabled={disabled} onClick={() => remove(i)} aria-label="Remove stop"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary hover:bg-danger-soft hover:text-danger disabled:opacity-30"><X className="h-4 w-4" /></button>
                  </div>
                </div>
                <Input value={s.note ?? ""} disabled={disabled} onChange={(e) => setNote(i, e.target.value)}
                  placeholder="Optional note for this stop…" className="mt-2 h-8 text-[12px]" aria-label={`Note for stop ${i + 1}`} />
              </li>
            );
          })}
        </ol>
      )}

      {/* POI picker (destination-scoped) */}
      {!disabled && (
        <div className="rounded-lg border border-border-subtle bg-surface-raised p-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search POIs in this destination to add…" className="pl-8" aria-label="Search POIs to add as waypoints" />
          </div>
          {query.trim() && (
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {available.length === 0 ? (
                <li className="px-2 py-2 text-[12px] text-ink-tertiary">No matching POIs available.</li>
              ) : available.slice(0, 30).map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => add(p)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-surface-hover">
                    <Landmark className="h-3.5 w-3.5 shrink-0 text-ink-tertiary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink-primary">{p.name}</span>
                      <span className="block text-[11px] text-ink-tertiary">{[catLabel(p.category), p.key, p.status].filter(Boolean).join(" · ")}</span>
                    </span>
                    <Plus className="h-4 w-4 shrink-0 text-ink-tertiary" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-[11px] text-ink-tertiary">Only POIs from this destination can be added — cross-destination stops are blocked.</p>
        </div>
      )}
    </div>
  );
}
