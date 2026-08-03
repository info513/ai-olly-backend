"use client";

import { useHotel } from "@/providers/hotel-provider";
import { useAiDaily, sumAi, priorRange, pctStr, deltaPct, secs, calcVersion, type AiRow } from "@/data/analytics";
import { useResolvedKnowledge } from "@/data/knowledge";
import { useUnanswered } from "@/data/unanswered";
import { AnalyticsShell, useRangeFromUrl } from "@/components/analytics/analytics-shell";
import { MetricTile, TrendChart, BarList } from "@/components/analytics/charts";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { Card } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

export default function AiAnalytics() {
  const { currentHotel } = useHotel();
  const range = useRangeFromUrl();
  const cur = useAiDaily(currentHotel?.id, range);
  const prev = useAiDaily(currentHotel?.id, priorRange(range));
  const resolved = useResolvedKnowledge(currentHotel?.id, "en", false);
  const unanswered = useUnanswered(currentHotel?.id);

  return (
    <AnalyticsShell title="AI analytics" subtitle="How the concierge performed — every rate shows its formula.">
      {cur.isError ? <ErrorState error={cur.error} onRetry={() => cur.refetch()} />
        : cur.isLoading ? <SectionLoader rows={4} />
        : (cur.data ?? []).length === 0 ? <EmptyState icon={Sparkles} title="No AI analytics for this period" hint="Once the AI answers guests, daily aggregates appear here. Your role may also not include AI analytics." />
        : <Body rows={cur.data!} prevRows={prev.data ?? []} range={range} resolved={resolved.data ?? []} unanswered={unanswered.data ?? []} />}
    </AnalyticsShell>
  );
}

function Body({ rows, prevRows, range, resolved, unanswered }: { rows: AiRow[]; prevRows: AiRow[]; range: ReturnType<typeof useRangeFromUrl>; resolved: any[]; unanswered: any[] }) {
  const s = sumAi(rows), p = sumAi(prevRows);
  const cv = calcVersion(rows);
  const sourceMix = ["hotel", "override", "destination", "platform"].map((k) => ({ label: k === "override" ? "Hotel override" : k[0].toUpperCase() + k.slice(1), value: resolved.filter((r) => r.source === k).length })).filter((x) => x.value > 0);
  const topUnanswered = [...unanswered].sort((a, b) => b.occurrence_count - a.occurrence_count).slice(0, 6).map((u) => ({ label: u.normalized_question, value: u.occurrence_count }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <MetricTile label="Total questions" value={s.total} delta={deltaPct(s.total, p.total)} spark={rows.map((r) => r.total_questions)} formula="Σ total_questions" />
        <MetricTile label="Deterministic" value={pctStr(s.det, s.total)} formula="deterministic ÷ total" tone="info" />
        <MetricTile label="Model answers" value={pctStr(s.model, s.total)} formula="model ÷ total" tone="info" />
        <MetricTile label="Safe handoff rate" value={pctStr(s.handoff, s.total)} delta={deltaPct(s.handoff, p.handoff)} invertDelta formula="safe_handoffs ÷ total" tone={s.total && s.handoff / s.total > 0.2 ? "warning" : "neutral"} />
        <MetricTile label="Unanswered (period)" value={s.unanswered} delta={deltaPct(s.unanswered, p.unanswered)} invertDelta formula="Σ unanswered" tone={s.unanswered ? "warning" : "neutral"} />
        <MetricTile label="Avg latency" value={secs(s.avgLatency)} formula="Σ(latency×q) ÷ Σq" />
        <MetricTile label="Tokens" value={(s.prompt + s.completion).toLocaleString()} formula="Σ prompt + completion" />
        <MetricTile label="Articles used" value={s.articlesUsed} formula="max daily distinct" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5"><TrendChart title={`Questions over time · ${range.label}`} points={rows.map((r) => ({ label: r.day.slice(5), value: r.total_questions }))} /></Card>
        <Card className="p-5"><TrendChart title="Safe handoffs over time" points={rows.map((r) => ({ label: r.day.slice(5), value: r.safe_handoffs }))} /></Card>
        <Card className="p-5">
          <div className="mb-3 text-[12px] font-medium text-ink-secondary">Live knowledge source mix (resolved)</div>
          {sourceMix.length ? <BarList items={sourceMix} /> : <p className="text-[13px] text-ink-tertiary">No resolved knowledge.</p>}
        </Card>
        <Card className="p-5">
          <div className="mb-3 text-[12px] font-medium text-ink-secondary">Top unanswered questions (normalized)</div>
          {topUnanswered.length ? <BarList items={topUnanswered} /> : <p className="text-[13px] text-ink-tertiary">No unanswered questions.</p>}
        </Card>
      </div>

      {cv && <p className="text-[11px] text-ink-tertiary">Formula version: <span className="font-mono">{cv}</span> · aggregates recomputed by the analytics refresh functions (timezone-aware).</p>}
    </div>
  );
}
