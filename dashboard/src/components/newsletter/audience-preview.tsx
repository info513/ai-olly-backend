"use client";

import { Users, ShieldCheck, Info } from "lucide-react";
import { useAudience } from "@/data/segments";
import { SectionLoader, ErrorState } from "@/components/content/states";
import { Card } from "@/components/ui/card";

/**
 * Live audience preview (Part 12). Counts come from resolve_newsletter_audience,
 * which ALWAYS filters to subscribed + granted marketing consent — unsubscribed,
 * suppressed and missing/revoked-consent subscribers are excluded server-side.
 * The sample shows masked emails. No fake counts.
 */
export function AudiencePreview({ segmentId }: { segmentId?: string }) {
  const q = useAudience(segmentId);
  if (!segmentId) return <p className="text-[13px] text-ink-tertiary">Select a segment to preview its audience.</p>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.isLoading || !q.data) return <SectionLoader rows={2} />;
  const a = q.data;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-md border border-success/30 bg-success-soft/20 px-4 py-3">
        <Users className="h-6 w-6 text-success" />
        <div><div className="font-display text-[24px] leading-none tabular-nums text-ink-primary">{a.eligible}</div><div className="text-[12px] text-ink-tertiary">eligible recipients</div></div>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-success"><ShieldCheck className="h-3.5 w-3.5" /> consent enforced</div>
      </div>

      {a.localeSplit.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {a.localeSplit.map((l) => <span key={l.locale} className="rounded-full border border-border-subtle px-2.5 py-0.5 text-[12px] text-ink-secondary">{l.locale}: {l.count}</span>)}
        </div>
      )}

      {a.eligible === 0 ? (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning-soft/30 px-3 py-2 text-[12px] text-warning"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> No eligible recipients — everyone is unsubscribed, suppressed, or missing marketing consent.</p>
      ) : (
        <Card className="p-0">
          <div className="border-b border-border-subtle px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Sample (masked)</div>
          <div className="divide-y divide-border-subtle">
            {a.sample.map((r) => (
              <div key={r.subscriberId} className="flex items-center gap-2 px-3 py-1.5 text-[12px]"><span className="min-w-0 flex-1 truncate font-mono text-ink-secondary">{r.email}</span>{r.locale && <span className="uppercase text-ink-tertiary">{r.locale}</span>}</div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
