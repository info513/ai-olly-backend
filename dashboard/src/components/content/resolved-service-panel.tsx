"use client";

import { Eye } from "lucide-react";
import { SourceBadge, VisibilityChips, CriticalBadge } from "./pills";
import { BlockView } from "./block-view";
import { SectionLoader, ErrorState, EmptyState } from "./states";
import { useResolvedServices } from "@/data/services";

/**
 * The hotel's live resolved services (Part 11): override wins over its platform
 * default, hidden/inactive/expired excluded, no duplicates — exactly what guests
 * and the AI receive. Dashboard preview only; no production endpoint is called.
 */
export function ResolvedServicePanel({ hotelId }: { hotelId?: string }) {
  const { data, isLoading, isError, error, refetch } = useResolvedServices(hotelId);
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">
        <Eye className="h-4 w-4" /> Resolved services — what guests get now
      </div>
      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SectionLoader rows={4} />
      ) : (data ?? []).length === 0 ? (
        <EmptyState icon={Eye} title="Nothing live yet" hint="Published, active, in-validity services appear here." />
      ) : (
        <div className="space-y-3">
          {data!.map((s) => (
            <div key={s.service_id} className="rounded-lg border border-border-subtle bg-surface-raised p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink-primary">{s.title}</span>
                    {s.is_critical && <CriticalBadge />}
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-tertiary">{s.category_name ?? "Uncategorized"}</div>
                </div>
                <SourceBadge source={s.source} />
              </div>
              {s.short_description && <p className="mt-2 text-[13px] text-ink-secondary">{s.short_description}</p>}
              <div className="mt-3 rounded-md bg-surface-sunken p-3"><BlockView body={s.body_content} /></div>
              <div className="mt-3"><VisibilityChips pwa={s.visible_in_pwa} web={s.visible_in_web} ai={s.available_to_ai} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
