"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Send, ChevronRight, Info, Plus } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useCampaigns } from "@/data/campaigns";
import { useNewsletterSummary } from "@/data/newsletter";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { CampaignStatusPill } from "@/components/newsletter/nl-pills";
import { Card } from "@/components/ui/card";
import { relativeTime, cn } from "@/lib/utils";
import type { Campaign } from "@/data/newsletter-types";

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
const FILTERS: [string, string][] = [["all", "All"], ["draft", "Draft"], ["scheduled", "Scheduled"], ["sent", "Sent"], ["cancelled", "Cancelled"]];

export default function CampaignsList() {
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const params = useSearchParams();
  const q = useCampaigns(currentHotel?.id);
  const summaryQ = useNewsletterSummary(currentHotel?.id);
  const [filter, setFilter] = React.useState(params.get("filter") ?? "all");
  const canManage = role === "platform_admin" || role === "hotel_admin" || role === "marketing";

  const camps = q.data ?? [];
  const items = filter === "all" ? camps : camps.filter((c) => c.status === filter);
  const sent = camps.filter((c) => c.status === "sent");
  const agg = sent.reduce((a, c) => ({ recipients: a.recipients + c.totals.recipients, delivered: a.delivered + c.totals.delivered, opened: a.opened + c.totals.opened, clicked: a.clicked + c.totals.clicked, bounced: a.bounced + c.totals.bounced, unsubscribed: a.unsubscribed + c.totals.unsubscribed }), { recipients: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0 });

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader
        crumbs={[{ label: "Newsletter", href: "/newsletter" }, { label: "Campaigns" }]}
        title="Campaigns"
        subtitle="Build, preview the consent-filtered audience, and schedule. Scheduling freezes a snapshot — no real send in this environment."
        actions={canManage && <Link href="/newsletter/campaigns/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[13px] font-semibold text-brand-navy hover:bg-brand-creamSoft"><Plus className="h-4 w-4" /> New campaign</Link>}
        backHref="/newsletter"
      />

      {/* Analytics overview — every rate shows its formula */}
      <div className="mb-5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Performance (across {sent.length} sent campaign{sent.length === 1 ? "" : "s"})</div>
        {sent.length === 0 ? (
          <Card className="p-6 text-center text-[13px] text-ink-tertiary">No sent campaigns yet — rates appear here once a campaign has delivery data. Total subscribers: {summaryQ.data?.totalSubscribers ?? "…"} · valid consent: {summaryQ.data?.validConsent ?? "…"}.</Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Metric label="Delivery rate" value={pct(agg.delivered, agg.recipients)} formula="delivered ÷ recipients" />
            <Metric label="Open rate" value={pct(agg.opened, agg.delivered)} formula="opened ÷ delivered" />
            <Metric label="Click rate" value={pct(agg.clicked, agg.delivered)} formula="clicked ÷ delivered" />
            <Metric label="Bounce rate" value={pct(agg.bounced, agg.recipients)} formula="bounced ÷ recipients" />
            <Metric label="Unsub rate" value={pct(agg.unsubscribed, agg.delivered)} formula="unsubscribed ÷ delivered" />
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map(([f, label]) => <button key={f} onClick={() => setFilter(f)} className={cn("rounded-full border px-3 py-1 text-[12px] transition-colors", filter === f ? "border-brand-goldDeep/50 bg-surface-base text-ink-primary" : "border-border-subtle text-ink-tertiary hover:text-ink-secondary")}>{label}</button>)}
      </div>

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <SectionLoader rows={4} />
        : items.length === 0 ? <EmptyState icon={Send} title={camps.length ? "No campaigns in this view" : "No campaigns yet"} hint={camps.length ? "Try another filter." : "Create your first campaign."} />
        : <Card className="overflow-hidden p-0"><div className="divide-y divide-border-subtle">{items.map((c) => <Row key={c.id} c={c} />)}</div></Card>}
    </div>
  );
}

function Metric({ label, value, formula }: { label: string; value: string; formula: string }) {
  return (
    <Card className="p-3.5">
      <div className="text-[12px] text-ink-tertiary">{label}</div>
      <div className="mt-1 font-display text-[22px] leading-none tabular-nums text-ink-primary">{value}</div>
      <div className="mt-1.5 flex items-center gap-1 font-mono text-[10px] text-ink-tertiary"><Info className="h-2.5 w-2.5" /> {formula}</div>
    </Card>
  );
}

function Row({ c }: { c: Campaign }) {
  return (
    <Link href={`/newsletter/campaigns/${c.id}`} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-overlay/50">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-ink-primary">{c.name}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-tertiary">
          {c.templateName && <span>{c.templateName}</span>}{c.segmentName && <><span>·</span><span>{c.segmentName}</span></>}
          {c.status === "scheduled" && c.scheduledAt && <><span>·</span><span>for {new Date(c.scheduledAt).toLocaleDateString()}</span></>}
          {c.status === "sent" && c.sentAt && <><span>·</span><span>sent {relativeTime(c.sentAt)}</span></>}
        </div>
      </div>
      {c.status === "sent" && <span className="hidden text-[12px] text-ink-tertiary sm:inline">{c.totals.delivered} delivered · {pct(c.totals.opened, c.totals.delivered)} open</span>}
      <CampaignStatusPill status={c.status} />
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
