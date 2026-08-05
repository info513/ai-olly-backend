"use client";

import { MapPin, Check } from "lucide-react";
import { usePlatform } from "@/providers/platform-provider";

/** Destinations list (Phase 1: read-only shell — no editing). Highlights the active destination. */
export default function PlatformDestinations() {
  const { destinations, currentDestination, setDestination, loading } = usePlatform();

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-primary">Destinations</h1>
        <p className="mt-1 text-sm text-ink-tertiary">
          Canonical destinations maintained by AI OLLY Platform. Select one to set your working context.
          Editing arrives in a later phase.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-ink-tertiary">Loading destinations…</p>
      ) : destinations.length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-8 text-center">
          <MapPin className="mx-auto h-6 w-6 text-ink-tertiary" />
          <p className="mt-3 text-sm text-ink-secondary">No destinations yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {destinations.map((d) => {
            const active = d.id === currentDestination?.id;
            return (
              <li key={d.id}>
                <button
                  onClick={() => setDestination(d.id)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${active ? "border-emerald-500/40 bg-emerald-500/5" : "border-border-subtle hover:bg-surface-hover"}`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-navy/50 text-brand-cream">
                    <MapPin className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-primary">{d.name}</span>
                    <span className="block text-[12px] text-ink-tertiary">
                      {[d.countryCode, d.slug, d.timezone].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${d.status === "active" ? "bg-emerald-500/10 text-emerald-500" : "bg-surface-overlay text-ink-tertiary"}`}>
                    {d.status ?? "—"}
                  </span>
                  {active && <Check className="h-4 w-4 text-emerald-500" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
