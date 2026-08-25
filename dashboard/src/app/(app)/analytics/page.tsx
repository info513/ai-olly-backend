"use client";

import Link from "next/link";
import { ArrowRight, HeartPulse, ShieldCheck, AlertTriangle, CircleAlert, MinusCircle } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useAiDaily, useOpsDaily, useContentDaily, useNewsletterDailyAgg, sumAi, sumOps, sumNl, latest, pctStr } from "@/data/analytics";
import { useHotelHealth, type HealthStatus } from "@/data/hotel-health";
import { useAssetsSummary } from "@/data/assets";
import { AnalyticsShell, useRangeFromUrl } from "@/components/analytics/analytics-shell";
import { MetricTile } from "@/components/analytics/charts";
import { Card } from "@/components/ui/card";

const HEALTH: Record<HealthStatus, { label: string; icon: typeof ShieldCheck; badge: string }> = {
  healthy: { label: "Healthy", icon: ShieldCheck, badge: "border-success/30 bg-success-soft/20 text-success" },
  attention: { label: "Needs attention", icon: AlertTriangle, badge: "border-warning/30 bg-warning-soft/20 text-warning" },
  critical: { label: "Critical", icon: CircleAlert, badge: "border-danger/30 bg-danger-soft/20 text-danger" },
  unavailable: { label: "—", icon: MinusCircle, badge: "border-border-subtle text-ink-tertiary" },
};

export default function AnalyticsOverview() {
  const { currentHotel } = useHotel();
  const range = useRangeFromUrl();
  const ai = useAiDaily(currentHotel?.id, range);
  const ops = useOpsDaily(currentHotel?.id, range);
  const nl = useNewsletterDailyAgg(currentHotel?.id, range);
  const content = useContentDaily(currentHotel?.id, range);
  const assets = useAssetsSummary(currentHotel?.id);
  const health = useHotelHealth(currentHotel?.id);

  const aiS = sumAi(ai.data ?? []);
  const opsS = sumOps(ops.data ?? []);
  const nlS = sumNl(nl.data ?? []);
  const ch = latest(content.data ?? []);

  return (
    <AnalyticsShell title="Insights" subtitle={`Overview for ${range.label.toLowerCase()}.`}>
      {/* Hotel health banner */}
      <Link href="/analytics/health" className="mb-5 block">
        <Card className="flex items-center gap-4 p-5 transition-colors hover:border-border-strong">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-navy text-brand-cream"><HeartPulse className="h-5 w-5" /></span>
          <div className="flex-1"><div className="font-display text-[18px] text-ink-primary">Hotel Health</div><div className="text-[12px] text-ink-tertiary">Explainable dimensions with direct fixes</div></div>
          {health.data && (() => { const M = HEALTH[health.data.overall]; const I = M.icon; return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] ${M.badge}`}><I className="h-3.5 w-3.5" /> {M.label}</span>; })()}
          <ArrowRight className="h-4 w-4 text-ink-tertiary" />
        </Card>
      </Link>

      {/* Domain headlines */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <MetricTile label="AI questions" value={aiS.total} formula="Σ total_questions" href="/analytics/ai" spark={(ai.data ?? []).map((r) => r.total_questions)} />
        <MetricTile label="AI handoff rate" value={pctStr(aiS.handoff, aiS.total)} formula="handoffs ÷ total" href="/analytics/ai" tone="info" />
        <MetricTile label="Content complete" value={ch?.completeness_score == null ? "—" : `${Math.round(Number(ch.completeness_score) * 100)}%`} formula="published ÷ (pub+draft+expired+critical)" href="/analytics/content" tone="info" />
        <MetricTile label="Requests" value={opsS.total} formula="Σ requests_total" href="/analytics/reception" spark={(ops.data ?? []).map((r) => r.requests_total)} />
        <MetricTile label="Resolved rate" value={pctStr(opsS.resolved, opsS.total)} formula="resolved ÷ total" href="/analytics/reception" tone="success" />
        <MetricTile label="Email open rate" value={pctStr(nlS.opened, nlS.delivered)} formula="opened ÷ delivered" href="/analytics/newsletter" tone="info" />
        <MetricTile label="Unused assets" value={assets.data?.unused.length ?? "—"} formula="0 usages, non-private" href="/analytics/assets" tone={assets.data?.unused.length ? "warning" : "neutral"} />
        <MetricTile label="Missing alt" value={assets.data?.missingAlt.length ?? "—"} formula="image-like, no alt" href="/analytics/assets" tone={assets.data?.missingAlt.length ? "warning" : "neutral"} />
      </div>

      <p className="mt-4 text-[11px] text-ink-tertiary">Each tile links to its full breakdown with charts and formulas. Metrics you can’t see are restricted by your role.</p>
    </AnalyticsShell>
  );
}
