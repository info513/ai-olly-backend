"use client";

import Link from "next/link";
import { Users, ShieldCheck, ShieldAlert, UserMinus, FileEdit, CalendarClock, Send, ArrowRight, Plus, Mail } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useNewsletterSummary } from "@/data/newsletter";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState } from "@/components/content/states";
import { CampaignStatusPill } from "@/components/newsletter/nl-pills";
import { Card } from "@/components/ui/card";
import { relativeTime } from "@/lib/utils";

const rate = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

export default function NewsletterHome() {
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const q = useNewsletterSummary(currentHotel?.id);
  const canManage = role === "platform_admin" || role === "hotel_admin" || role === "marketing";
  const d = q.data;

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader
        title="Newsletter"
        subtitle={`Email marketing for ${currentHotel?.name ?? "your hotel"} — consent-first, no send without valid consent.`}
        actions={canManage && (
          <div className="flex items-center gap-2">
            <Link href="/newsletter/subscribers" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong px-3 text-[13px] font-medium text-ink-secondary hover:text-ink-primary"><Plus className="h-4 w-4" /> Subscriber</Link>
            <Link href="/newsletter/campaigns/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[13px] font-semibold text-brand-navy hover:bg-brand-creamSoft"><Send className="h-4 w-4" /> New campaign</Link>
          </div>
        )}
      />

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading || !d ? <SectionLoader rows={5} />
        : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat icon={Users} label="Active subscribers" value={d.activeSubscribers} href="/newsletter/subscribers?filter=subscribed" tone="info" />
            <Stat icon={ShieldCheck} label="Valid consent" value={d.validConsent} href="/newsletter/subscribers?filter=subscribed" tone="success" />
            <Stat icon={ShieldAlert} label="Consent missing" value={d.consentMissing} href="/newsletter/subscribers?filter=consent-missing" tone={d.consentMissing ? "warning" : "muted"} />
            <Stat icon={UserMinus} label="Unsub / suppressed" value={d.unsubscribedSuppressed} href="/newsletter/subscribers?filter=unsubscribed" tone="muted" />
            <Stat icon={FileEdit} label="Draft campaigns" value={d.draftCampaigns} href="/newsletter/campaigns?filter=draft" tone="muted" />
            <Stat icon={CalendarClock} label="Scheduled" value={d.scheduledCampaigns} href="/newsletter/campaigns?filter=scheduled" tone={d.scheduledCampaigns ? "info" : "muted"} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {/* Modules */}
            <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
              <ModuleCard href="/newsletter/subscribers" icon={Users} title="Subscribers" desc={`${d.totalSubscribers} total · consent status & lifecycle`} />
              <ModuleCard href="/newsletter/segments" icon={Users} title="Segments" desc="Static lists & validated rule audiences" />
              <ModuleCard href="/newsletter/templates" icon={Mail} title="Templates" desc="Draft → publish → history, email preview" />
              <ModuleCard href="/newsletter/campaigns" icon={Send} title="Campaigns" desc="Build, preview audience, schedule (frozen snapshot)" />
            </div>

            {/* Last campaign + quick actions */}
            <div className="space-y-4">
              <Card className="p-5">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Last campaign</div>
                {d.lastCampaign ? (
                  <Link href={`/newsletter/campaigns/${d.lastCampaign.id}`} className="block">
                    <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink-primary">{d.lastCampaign.name}</span><CampaignStatusPill status={d.lastCampaign.status} /></div>
                    {d.lastCampaign.status === "sent" && (
                      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[12px]">
                        <div><div className="font-display text-[16px] text-ink-primary">{d.lastCampaign.totals.delivered}</div><div className="text-ink-tertiary">delivered</div></div>
                        <div><div className="font-display text-[16px] text-ink-primary">{rate(d.lastCampaign.totals.opened, d.lastCampaign.totals.delivered)}</div><div className="text-ink-tertiary">open</div></div>
                        <div><div className="font-display text-[16px] text-ink-primary">{rate(d.lastCampaign.totals.clicked, d.lastCampaign.totals.delivered)}</div><div className="text-ink-tertiary">click</div></div>
                      </div>
                    )}
                  </Link>
                ) : <p className="text-[13px] text-ink-tertiary">No campaigns yet.</p>}
              </Card>

              {canManage && (
                <Card className="p-5">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Quick actions</div>
                  <div className="space-y-2">
                    <Quick icon={Send} label="New campaign" href="/newsletter/campaigns/new" />
                    <Quick icon={Plus} label="Add subscriber" href="/newsletter/subscribers" />
                    <Quick icon={Users} label="Create segment" href="/newsletter/segments" />
                  </div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, href, tone }: { icon: typeof Users; label: string; value: number; href: string; tone: "info" | "success" | "warning" | "muted" }) {
  const color = tone === "warning" && value ? "text-warning" : tone === "success" && value ? "text-success" : tone === "info" && value ? "text-info" : "text-ink-primary";
  return (
    <Link href={href}>
      <Card className="p-3.5 transition-colors hover:border-border-strong">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-overlay text-ink-secondary"><Icon className="h-4 w-4" /></span>
        <div className={`mt-2 font-display text-[22px] leading-none tabular-nums ${color}`}>{value}</div>
        <div className="mt-1 text-[12px] text-ink-tertiary">{label}</div>
      </Card>
    </Link>
  );
}
function ModuleCard({ href, icon: Icon, title, desc }: { href: string; icon: typeof Users; title: string; desc: string }) {
  return (
    <Link href={href}>
      <Card className="group h-full p-5 transition-colors hover:border-border-strong">
        <div className="flex items-start justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-navy text-brand-cream"><Icon className="h-5 w-5" /></span><ArrowRight className="h-4 w-4 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" /></div>
        <div className="mt-4 font-display text-[18px] text-ink-primary">{title}</div>
        <p className="mt-1 text-[13px] text-ink-secondary">{desc}</p>
      </Card>
    </Link>
  );
}
function Quick({ icon: Icon, label, href }: { icon: typeof Send; label: string; href: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-md border border-border-subtle px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-surface-overlay/40">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-navy text-brand-cream"><Icon className="h-4 w-4" /></span>
      <span className="flex-1 text-[13px] font-medium text-ink-primary">{label}</span>
      <ArrowRight className="h-4 w-4 shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
