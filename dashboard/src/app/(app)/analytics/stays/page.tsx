"use client";

import { useHotel } from "@/providers/hotel-provider";
import { useStays } from "@/data/stays";
import { useGuests, useDuplicateSuggestions } from "@/data/guests";
import { AnalyticsShell } from "@/components/analytics/analytics-shell";
import { MetricTile, BarList } from "@/components/analytics/charts";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { Card } from "@/components/ui/card";
import { CalendarCheck } from "lucide-react";

const today = () => new Date().toISOString().slice(0, 10);

export default function StaysAnalytics() {
  const { currentHotel } = useHotel();
  const staysQ = useStays(currentHotel?.id);
  const guestsQ = useGuests(currentHotel?.id);
  const dupQ = useDuplicateSuggestions(currentHotel?.id);

  return (
    <AnalyticsShell title="Guests & Stays analytics" subtitle="Safe aggregates only — no revenue, occupancy % or booking-channel claims (no PMS).">
      {staysQ.isError ? <ErrorState error={staysQ.error} onRetry={() => staysQ.refetch()} />
        : staysQ.isLoading ? <SectionLoader rows={4} />
        : (staysQ.data ?? []).length === 0 && (guestsQ.data ?? []).length === 0 ? <EmptyState icon={CalendarCheck} title="No stay data" hint="Guest & stay analytics need reception access. Create stays to populate this." />
        : <Body stays={staysQ.data ?? []} guests={guestsQ.data ?? []} dups={(dupQ.data ?? []).filter((d) => d.status === "pending").length} />}
    </AnalyticsShell>
  );
}

function Body({ stays, guests, dups }: { stays: any[]; guests: any[]; dups: number }) {
  const arriving = stays.filter((s) => s.status === "reserved" && s.arrivalAt?.slice(0, 10) === today()).length;
  const departing = stays.filter((s) => s.status === "checked_in" && s.departureAt?.slice(0, 10) === today()).length;
  const active = stays.filter((s) => s.status === "checked_in").length;
  const completed = stays.filter((s) => s.status === "checked_out");
  const lengths = completed.filter((s) => s.arrivalAt && s.departureAt).map((s) => (new Date(s.departureAt).getTime() - new Date(s.arrivalAt).getTime()) / 864e5);
  const avgLen = lengths.length ? (lengths.reduce((a, b) => a + b, 0) / lengths.length) : null;
  const withConsent = guests.filter((g) => g.hasConsent).length;
  const consentPct = guests.length ? Math.round((withConsent / guests.length) * 100) : null;

  const localeSplit = Object.entries(guests.reduce((m: Record<string, number>, g) => { const l = g.preferredLocale ?? "—"; m[l] = (m[l] ?? 0) + 1; return m; }, {})).map(([label, value]) => ({ label: label.toUpperCase(), value: value as number })).sort((a, b) => b.value - a.value);
  const countrySplit = Object.entries(guests.reduce((m: Record<string, number>, g) => { if (g.countryCode) m[g.countryCode] = (m[g.countryCode] ?? 0) + 1; return m; }, {})).map(([label, value]) => ({ label, value: value as number })).sort((a, b) => b.value - a.value).slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <MetricTile label="Arriving today" value={arriving} formula="reserved AND arrival = today" href="/reception#arrivals" />
        <MetricTile label="Departing today" value={departing} formula="in-house AND departure = today" href="/reception#departures" />
        <MetricTile label="In house" value={active} formula="status = checked_in" tone="info" />
        <MetricTile label="Completed" value={completed.length} formula="status = checked_out" />
        <MetricTile label="Avg stay length" value={avgLen == null ? "—" : `${avgLen.toFixed(1)}d`} formula="mean(departure − arrival) of completed" />
        <MetricTile label="Consent completion" value={consentPct == null ? "—" : `${consentPct}%`} formula="guests with consent ÷ guests" tone={consentPct != null && consentPct < 60 ? "warning" : "success"} />
        <MetricTile label="Possible duplicates" value={dups} formula="pending guest_duplicate_suggestions" href="/guests/duplicates" tone={dups ? "warning" : "neutral"} />
        <MetricTile label="Guests" value={guests.length} formula="guest records" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5"><div className="mb-3 text-[12px] font-medium text-ink-secondary">Preferred locale</div>{localeSplit.length ? <BarList items={localeSplit} /> : <p className="text-[13px] text-ink-tertiary">No data.</p>}</Card>
        <Card className="p-5"><div className="mb-3 text-[12px] font-medium text-ink-secondary">Country</div>{countrySplit.length ? <BarList items={countrySplit} /> : <p className="text-[13px] text-ink-tertiary">No country data.</p>}</Card>
      </div>
      <p className="text-[11px] text-ink-tertiary">Aggregate counts only — no individual guest identities. Occupancy % / revenue / booking channels require PMS data not present in this system.</p>
    </div>
  );
}
