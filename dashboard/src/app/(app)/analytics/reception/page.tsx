"use client";

import { useHotel } from "@/providers/hotel-provider";
import { useOpsDaily, sumOps, priorRange, secs, deltaPct, pctStr, calcVersion, type OpsRow } from "@/data/analytics";
import { useRequests, isRequestOverdue } from "@/data/reception";
import { useFeedback } from "@/data/feedback";
import { AnalyticsShell, useRangeFromUrl } from "@/components/analytics/analytics-shell";
import { MetricTile, TrendChart, BarList } from "@/components/analytics/charts";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { Card } from "@/components/ui/card";
import { ConciergeBell } from "lucide-react";

export default function ReceptionAnalytics() {
  const { currentHotel } = useHotel();
  const range = useRangeFromUrl();
  const cur = useOpsDaily(currentHotel?.id, range);
  const prev = useOpsDaily(currentHotel?.id, priorRange(range));
  const requests = useRequests(currentHotel?.id);
  const feedback = useFeedback(currentHotel?.id);

  return (
    <AnalyticsShell title="Reception analytics" subtitle="Request workload, responsiveness and feedback — no guest identities in charts.">
      {cur.isError ? <ErrorState error={cur.error} onRetry={() => cur.refetch()} />
        : cur.isLoading ? <SectionLoader rows={4} />
        : (cur.data ?? []).length === 0 ? <EmptyState icon={ConciergeBell} title="No reception analytics for this period" hint="Operations aggregates appear here. Your role may not include reception analytics." />
        : <Body rows={cur.data!} prevRows={prev.data ?? []} requests={requests.data ?? []} feedback={feedback.data ?? []} />}
    </AnalyticsShell>
  );
}

function Body({ rows, prevRows, requests, feedback }: { rows: OpsRow[]; prevRows: OpsRow[]; requests: any[]; feedback: any[] }) {
  const s = sumOps(rows), p = sumOps(prevRows);
  const cv = calcVersion(rows);
  const open = requests.filter((r) => ["new", "acknowledged", "in_progress"].includes(r.status));
  const overdue = requests.filter((r) => isRequestOverdue(r));
  const types = Object.entries(requests.reduce((m: Record<string, number>, r) => { m[r.requestType] = (m[r.requestType] ?? 0) + 1; return m; }, {})).map(([label, value]) => ({ label: label.replace(/_/g, " "), value: value as number })).sort((a, b) => b.value - a.value).slice(0, 6);
  const followUp = feedback.filter((f) => f.followUpRequested && f.status !== "resolved").length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <MetricTile label="Requests (period)" value={s.total} delta={deltaPct(s.total, p.total)} spark={rows.map((r) => r.requests_total)} formula="Σ requests_total" />
        <MetricTile label="Resolved" value={pctStr(s.resolved, s.total)} formula="resolved ÷ total" tone="success" />
        <MetricTile label="Open now" value={open.length} formula="live: new/ack/in-progress" href="/reception/requests?filter=open" tone={open.length ? "info" : "neutral"} />
        <MetricTile label="Overdue now" value={overdue.length} formula="live: open past SLA by priority" href="/reception/requests?filter=overdue" tone={overdue.length ? "danger" : "neutral"} />
        <MetricTile label="Avg acknowledge" value={secs(s.avgAck)} formula="Σ(ack×req) ÷ Σreq" invertDelta />
        <MetricTile label="Avg resolution" value={secs(s.avgResolution)} formula="Σ(resolution×resolved) ÷ Σresolved" />
        <MetricTile label="Avg rating" value={s.avgRating == null ? "—" : s.avgRating.toFixed(1)} formula="Σ(rating×n) ÷ Σn" tone="info" />
        <MetricTile label="Feedback follow-ups" value={followUp} formula="live: follow-up requested, unresolved" href="/reception/feedback?filter=followup" tone={followUp ? "warning" : "neutral"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5"><TrendChart title="Request volume over time" points={rows.map((r) => ({ label: r.day.slice(5), value: r.requests_total }))} /></Card>
        <Card className="p-5"><TrendChart title="Arrivals over time" points={rows.map((r) => ({ label: r.day.slice(5), value: r.stays_arriving }))} /></Card>
        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 text-[12px] font-medium text-ink-secondary">Request types (live)</div>
          {types.length ? <BarList items={types} /> : <p className="text-[13px] text-ink-tertiary">No requests.</p>}
        </Card>
      </div>
      {cv && <p className="text-[11px] text-ink-tertiary">Formula version: <span className="font-mono">{cv}</span>. Charts show counts only — never guest identities.</p>}
    </div>
  );
}
