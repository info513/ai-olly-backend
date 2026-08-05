"use client";

import { Globe, ChevronsUpDown } from "lucide-react";
import { usePlatform } from "@/providers/platform-provider";

/** Platform CMS destination context switcher (Country → Destination), separate from the
 *  hotel switcher. Shell only: selects + persists the active destination; no editing. */
export function DestinationSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { destinations, currentDestination, setDestination, loading } = usePlatform();

  // Group destinations by country for the Country → Destination structure.
  const byCountry = new Map<string, typeof destinations>();
  for (const d of destinations) {
    const key = d.countryCode || "—";
    (byCountry.get(key) ?? byCountry.set(key, []).get(key)!).push(d);
  }

  if (collapsed) {
    return (
      <div className="flex justify-center py-1" title={currentDestination?.name ?? "Destination"}>
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-navy/50 text-brand-cream">
          <Globe className="h-4 w-4" />
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-surface-raised px-2.5 py-2">
      <label className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary">
        <Globe className="h-3 w-3" /> Destination
      </label>
      <div className="relative">
        <select
          aria-label="Select destination"
          disabled={loading || destinations.length === 0}
          value={currentDestination?.id ?? ""}
          onChange={(e) => setDestination(e.target.value)}
          className="w-full cursor-pointer appearance-none rounded-md bg-surface-sunken px-2.5 py-1.5 pr-7 text-[13px] font-medium text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2 disabled:opacity-60"
        >
          {destinations.length === 0 && <option value="">{loading ? "Loading…" : "No destinations"}</option>}
          {[...byCountry.entries()].map(([country, list]) => (
            <optgroup key={country} label={country}>
              {list.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronsUpDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-tertiary" />
      </div>
    </div>
  );
}
