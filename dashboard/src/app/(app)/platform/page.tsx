"use client";

import Link from "next/link";
import { MapPin, Landmark, Route, Sparkles, CalendarDays, Languages, HeartPulse, Building2, Plus, DownloadCloud, FileClock, ArrowRight } from "lucide-react";
import { usePlatform } from "@/providers/platform-provider";
import { usePlatformStats } from "@/data/platform";
import { MetricTile } from "@/components/analytics/charts";

export default function PlatformHome() {
  const { currentDestination, destinations } = usePlatform();
  const { data: s } = usePlatformStats(currentDestination?.id);

  const cards = [
    { label: "Destinations", value: s?.destinations, icon: MapPin, href: "/platform/destinations" },
    { label: `POIs · ${currentDestination?.name ?? "—"}`, value: s?.pois, icon: Landmark, href: "/platform/pois" },
    { label: "Routes", value: s?.routes, icon: Route, href: "/platform/routes" },
    { label: "Whispers", value: s?.whispers, icon: Sparkles, href: "/platform/whispers" },
    { label: "Events", value: s?.events, icon: CalendarDays, href: "/platform/events" },
    { label: "Translations", value: s?.translations, icon: Languages, href: "/platform/translations" },
    { label: "Content Health", value: "—", icon: HeartPulse, href: "/platform/content-health" },
    { label: "Hotels using destination", value: s?.hotels, icon: Building2, href: undefined as string | undefined },
  ];

  const actions = [
    { label: "New destination", icon: Plus, href: "/platform/destinations" },
    { label: "Import destination", icon: DownloadCloud, href: "/platform/migration" },
    { label: "Review drafts", icon: FileClock, href: "/platform/content-health" },
    { label: "Content Health", icon: HeartPulse, href: "/platform/content-health" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-primary">Platform CMS</h1>
        <p className="mt-1 text-sm text-ink-tertiary">
          Canonical destination content, maintained centrally by AI OLLY Platform.
          {currentDestination && <> Current destination: <span className="font-medium text-ink-secondary">{currentDestination.name}</span>.</>}
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <MetricTile key={c.label} label={c.label} value={c.value ?? "—"} href={c.href} />
        ))}
      </section>

      <section className="rounded-xl border border-border-subtle bg-surface-raised p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-primary">Quick actions</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {actions.map((a) => (
            <Link key={a.label} href={a.href}
              className="flex items-center gap-3 rounded-lg border border-border-subtle px-3 py-2.5 transition hover:bg-surface-hover">
              <a.icon className="h-4 w-4 text-ink-tertiary" />
              <span className="flex-1 text-sm font-medium text-ink-primary">{a.label}</span>
              <ArrowRight className="h-4 w-4 text-ink-tertiary" />
            </Link>
          ))}
        </div>
      </section>

      <p className="text-[12px] text-ink-tertiary">
        Phase 1 ships the shell. Destination modules (POIs, Routes, Whispers, Events, Media, AI Knowledge,
        Translations, Content Health) arrive in later phases. {destinations.length} destination(s) available.
      </p>
    </div>
  );
}
