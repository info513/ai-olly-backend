"use client";

import { useHotel } from "@/providers/hotel-provider";
import { useContentDaily, latest, calcVersion, type ContentRow } from "@/data/analytics";
import { useHomeContent } from "@/data/home";
import { AnalyticsShell, useRangeFromUrl } from "@/components/analytics/analytics-shell";
import { MetricTile, TrendChart, BarList } from "@/components/analytics/charts";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { Card } from "@/components/ui/card";
import { FileText } from "lucide-react";

export default function ContentAnalytics() {
  const { currentHotel } = useHotel();
  const range = useRangeFromUrl();
  const q = useContentDaily(currentHotel?.id, range);
  const live = useHomeContent(currentHotel?.id);

  return (
    <AnalyticsShell title="Content analytics" subtitle="Publishing health across rooms, services and AI knowledge.">
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <SectionLoader rows={4} />
        : (q.data ?? []).length === 0 ? <EmptyState icon={FileText} title="No content analytics for this period" hint="Content health aggregates appear here. Your role may not include content analytics." />
        : <Body rows={q.data!} live={live.data} />}
    </AnalyticsShell>
  );
}

function Body({ rows, live }: { rows: ContentRow[]; live: any }) {
  const l = latest(rows)!;
  const cv = calcVersion(rows);
  const breakdown = live ? [
    { label: "Service drafts", value: live.serviceDrafts },
    { label: "Knowledge drafts", value: live.knowledgeDrafts },
    { label: "Services expired", value: live.serviceExpired },
    { label: "Knowledge expired", value: live.knowledgeExpired },
    { label: "Not AI-visible", value: live.servicesNotAvailableToAi },
  ].filter((x) => x.value > 0) : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <MetricTile label="Published" value={l.published_count} spark={rows.map((r) => r.published_count)} tone="success" formula="knowledge published (latest day)" />
        <MetricTile label="Drafts" value={l.draft_count} spark={rows.map((r) => r.draft_count)} formula="status = draft" tone={l.draft_count ? "info" : "neutral"} />
        <MetricTile label="Archived" value={l.archived_count} formula="status = archived" />
        <MetricTile label="Expired" value={l.expired_count} formula="published AND valid_to < now" tone={l.expired_count ? "warning" : "neutral"} />
        <MetricTile label="Critical pending" value={l.critical_pending} formula="is_critical AND ≠ published" tone={l.critical_pending ? "danger" : "neutral"} href="/ai/knowledge?filter=critical-pending" />
        <MetricTile label="Unresolved unanswered" value={l.unresolved_unanswered} formula="unanswered where status=open" tone={l.unresolved_unanswered ? "warning" : "neutral"} href="/ai/unanswered" />
        <MetricTile label="Completeness" value={l.completeness_score == null ? "—" : `${Math.round(Number(l.completeness_score) * 100)}%`} formula="published ÷ (published+draft+expired+critical_pending)" tone="info" />
        <MetricTile label="Unused assets" value={l.unused_assets} formula="assets with 0 usages" href="/assets/usage?filter=unused" tone={l.unused_assets ? "warning" : "neutral"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5"><TrendChart title="Completeness over time" points={rows.map((r) => ({ label: r.day.slice(5), value: r.completeness_score == null ? 0 : Math.round(Number(r.completeness_score) * 100) }))} unit="%" /></Card>
        <Card className="p-5"><TrendChart title="Published vs drafts" points={rows.map((r) => ({ label: r.day.slice(5), value: r.published_count }))} /></Card>
        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 text-[12px] font-medium text-ink-secondary">Live warnings by area</div>
          {breakdown.length ? <BarList items={breakdown} /> : <p className="text-[13px] text-ink-tertiary">No content warnings — everything published and in-date.</p>}
        </Card>
      </div>
      {cv && <p className="text-[11px] text-ink-tertiary">Formula version: <span className="font-mono">{cv}</span>.</p>}
    </div>
  );
}
