"use client";

import { useHotel } from "@/providers/hotel-provider";
import { useNewsletterDailyAgg, sumNl, priorRange, pctStr, deltaPct, calcVersion, type NlRow } from "@/data/analytics";
import { useSubscribers } from "@/data/subscribers";
import { useCampaigns } from "@/data/campaigns";
import { AnalyticsShell, useRangeFromUrl } from "@/components/analytics/analytics-shell";
import { MetricTile, TrendChart, BarList } from "@/components/analytics/charts";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { Card } from "@/components/ui/card";
import { Send } from "lucide-react";

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

export default function NewsletterAnalytics() {
  const { currentHotel } = useHotel();
  const range = useRangeFromUrl();
  const cur = useNewsletterDailyAgg(currentHotel?.id, range);
  const prev = useNewsletterDailyAgg(currentHotel?.id, priorRange(range));
  const subs = useSubscribers(currentHotel?.id);
  const camps = useCampaigns(currentHotel?.id);

  return (
    <AnalyticsShell title="Newsletter analytics" subtitle="Consent-first email performance — every rate shows its formula. Synthetic data; no real send.">
      {cur.isError ? <ErrorState error={cur.error} onRetry={() => cur.refetch()} />
        : cur.isLoading ? <SectionLoader rows={4} />
        : (cur.data ?? []).length === 0 ? <EmptyState icon={Send} title="No newsletter analytics for this period" hint="Newsletter aggregates appear here. Your role may not include newsletter analytics." />
        : <Body rows={cur.data!} prevRows={prev.data ?? []} subs={subs.data ?? []} camps={camps.data ?? []} />}
    </AnalyticsShell>
  );
}

function Body({ rows, prevRows, subs, camps }: { rows: NlRow[]; prevRows: NlRow[]; subs: any[]; camps: any[] }) {
  const s = sumNl(rows), p = sumNl(prevRows);
  const cv = calcVersion(rows);
  const active = subs.filter((x) => x.status === "subscribed");
  const validConsent = active.filter((x) => x.consentState === "active").length;
  const consentMissing = active.filter((x) => x.consentState !== "active").length;
  const unsub = subs.filter((x) => x.status === "unsubscribed").length;
  const suppressed = subs.filter((x) => x.status === "suppressed").length;
  const localeSplit = Object.entries(subs.reduce((m: Record<string, number>, x) => { const l = x.locale ?? "—"; m[l] = (m[l] ?? 0) + 1; return m; }, {})).map(([label, value]) => ({ label: label.toUpperCase(), value: value as number })).sort((a, b) => b.value - a.value);
  const sourceSplit = Object.entries(subs.reduce((m: Record<string, number>, x) => { const l = x.source ?? "—"; m[l] = (m[l] ?? 0) + 1; return m; }, {})).map(([label, value]) => ({ label, value: value as number })).sort((a, b) => b.value - a.value);
  const sentCampaigns = camps.filter((c) => c.status === "sent");
  const campCompare = sentCampaigns.slice(0, 6).map((c) => ({ label: c.name, value: c.totals.delivered ? Math.round((c.totals.opened / c.totals.delivered) * 100) : 0 }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <MetricTile label="Active subscribers" value={active.length} formula="status = subscribed" href="/newsletter/subscribers?filter=subscribed" />
        <MetricTile label="Valid consent" value={validConsent} formula="subscribed AND consent active" tone="success" />
        <MetricTile label="Consent missing" value={consentMissing} formula="subscribed AND consent ≠ active" href="/newsletter/subscribers?filter=consent-missing" tone={consentMissing ? "warning" : "neutral"} />
        <MetricTile label="Unsub / suppressed" value={`${unsub} / ${suppressed}`} formula="status counts" />
        <MetricTile label="Delivery rate" value={pct(s.delivered, s.sent)} delta={deltaPct(s.delivered, p.delivered)} formula="delivered ÷ sent" />
        <MetricTile label="Open rate" value={pct(s.opened, s.delivered)} delta={deltaPct(s.opened, p.opened)} formula="opened ÷ delivered" tone="info" />
        <MetricTile label="Click rate" value={pct(s.clicked, s.delivered)} formula="clicked ÷ delivered" tone="info" />
        <MetricTile label="Bounce / unsub rate" value={`${pct(s.bounced, s.sent)} / ${pct(s.unsubscribed, s.delivered)}`} formula="bounced÷sent · unsub÷delivered" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5"><TrendChart title="Opens over time" points={rows.map((r) => ({ label: r.day.slice(5), value: r.opened }))} /></Card>
        <Card className="p-5"><div className="mb-3 text-[12px] font-medium text-ink-secondary">Campaign open rate comparison</div>{campCompare.length ? <BarList items={campCompare} unit="%" /> : <p className="text-[13px] text-ink-tertiary">No sent campaigns.</p>}</Card>
        <Card className="p-5"><div className="mb-3 text-[12px] font-medium text-ink-secondary">Locale distribution</div>{localeSplit.length ? <BarList items={localeSplit} /> : <p className="text-[13px] text-ink-tertiary">No data.</p>}</Card>
        <Card className="p-5"><div className="mb-3 text-[12px] font-medium text-ink-secondary">Subscriber source</div>{sourceSplit.length ? <BarList items={sourceSplit} /> : <p className="text-[13px] text-ink-tertiary">No data.</p>}</Card>
      </div>
      {cv && <p className="text-[11px] text-ink-tertiary">Formula version: <span className="font-mono">{cv}</span>.</p>}
    </div>
  );
}
