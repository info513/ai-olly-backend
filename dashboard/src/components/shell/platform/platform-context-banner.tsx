"use client";

import { ChevronRight } from "lucide-react";
import { usePlatform } from "@/providers/platform-provider";
import { useHotel } from "@/providers/hotel-provider";

/** Always-visible context trail so a platform admin never wonders where they are editing:
 *  Platform → Country → Destination → Hotel (if applicable). Architecture §12 (context clarity). */
export function PlatformContextBanner() {
  const { currentDestination } = usePlatform();
  const { currentHotel } = useHotel();

  const Crumb = ({ label, tone }: { label: string; tone: "platform" | "country" | "destination" | "hotel" }) => {
    const toneCls =
      tone === "platform" ? "bg-brand-cream/15 text-brand-cream border-brand-cream/30"
      : tone === "destination" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
      : tone === "hotel" ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
      : "bg-surface-overlay text-ink-secondary border-border-subtle";
    return <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${toneCls}`}>{label}</span>;
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Editing context">
      <Crumb label="Platform" tone="platform" />
      {currentDestination && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-ink-tertiary" />
          <Crumb label={currentDestination.countryCode || "—"} tone="country" />
          <ChevronRight className="h-3.5 w-3.5 text-ink-tertiary" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary">Editing</span>
          <Crumb label={currentDestination.name} tone="destination" />
        </>
      )}
      {currentHotel && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-ink-tertiary" />
          <Crumb label={currentHotel.name} tone="hotel" />
        </>
      )}
    </div>
  );
}
