"use client";

import Link from "next/link";
import { MapPin, Route as RouteIcon, Sparkles, CalendarDays, EyeOff, Star, PencilLine, ChevronRight } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useHotelPresentationSummary, type PresEntity } from "@/data/hotel-presentation";
import { PlatformMaintainedBanner } from "@/components/presentation/presentation-manager";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const CARDS: { entity: PresEntity; label: string; href: string; icon: React.ReactNode; blurb: string }[] = [
  { entity: "poi", label: "Points of interest", href: "/presentation/pois", icon: <MapPin className="h-5 w-5" />, blurb: "Nearby places to recommend" },
  { entity: "route", label: "Routes", href: "/presentation/routes", icon: <RouteIcon className="h-5 w-5" />, blurb: "Walks & itineraries" },
  { entity: "whisper", label: "Whispers", href: "/presentation/whispers", icon: <Sparkles className="h-5 w-5" />, blurb: "Destination story chapters" },
  { entity: "event", label: "Events", href: "/presentation/events", icon: <CalendarDays className="h-5 w-5" />, blurb: "Local happenings" },
];

export default function PresentationHome() {
  const { currentHotel } = useHotel();
  const { data, isLoading } = useHotelPresentationSummary(currentHotel?.id);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-primary">Recommendations</h1>
        <p className="mt-1 text-sm text-ink-tertiary">Choose how Split's places, routes and events appear to <span className="font-medium text-ink-secondary">{currentHotel?.name ?? "your hotel"}</span>’s guests — what’s shown, what’s featured, the order, and your own notes. The facts stay maintained by AI OLLY; you control the presentation.</p>
      </header>

      <PlatformMaintainedBanner />

      <div className="grid gap-3 sm:grid-cols-2">
        {CARDS.map((c) => {
          const s = data?.[c.entity];
          return (
            <Link key={c.entity} href={c.href}>
              <Card className="group flex items-center gap-4 p-4 transition hover:border-brand-goldDeep/50 hover:shadow-sm">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-navy/50 text-brand-cream">{c.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-ink-primary">{c.label}</div>
                  <div className="text-[12px] text-ink-tertiary">{c.blurb}</div>
                  {isLoading ? (
                    <Skeleton className="mt-1.5 h-4 w-40" />
                  ) : s ? (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-tertiary">
                      <span>{s.total} shared</span>
                      {s.hidden > 0 && <span className="inline-flex items-center gap-1"><EyeOff className="h-3 w-3" /> {s.hidden} hidden</span>}
                      {s.featured > 0 && <span className="inline-flex items-center gap-1"><Star className="h-3 w-3" /> {s.featured} featured</span>}
                      {s.customized > 0 && <span className="inline-flex items-center gap-1"><PencilLine className="h-3 w-3" /> {s.customized} customized</span>}
                    </div>
                  ) : null}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary transition group-hover:translate-x-0.5" />
              </Card>
            </Link>
          );
        })}
      </div>

      <p className="text-[12px] text-ink-tertiary">Canonical facts are maintained by the AI OLLY Platform and shared across hotels. Your hotel controls presentation only — changes here never alter the underlying destination content and persist independently when the platform updates it.</p>
    </div>
  );
}
