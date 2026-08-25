"use client";

import Link from "next/link";
import { Users, ShieldCheck, ShieldAlert, UserMinus, FileEdit, CalendarClock, Send, ArrowRight, Mail, UsersRound, LayoutTemplate } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useNewsletterSummary } from "@/data/newsletter";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState } from "@/components/content/states";
import { CampaignStatusPill } from "@/components/newsletter/nl-pills";
import { Card } from "@/components/ui/card";

const rate = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
const STEPS = ["Audience", "Design", "Preview", "Schedule"];

export default function MarketingHome() {
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const q = useNewsletterSummary(currentHotel?.id);
  const canManage = role === "platform_admin" || role === "hotel_admin" || role === "marketing";
  const d = q.data;

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader
        title="Marketing"
        subtitle={`Reach past guests of ${currentHotel?.name ?? "your hotel"} by email — consent-first, never sent without valid consent.`}
        actions={canManage && (
          <Link href="/newsletter/campaigns/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[13px] font-semibold text-brand-navy hover:bg-brand-creamSoft"><Send className="h-4 w-4" /> New campaign</Link>
        )}
      />

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading || !d ? <SectionLoader rows={5} />
        : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Campaigns — the primary workflow */}
          <div className="space-y-4 lg:col-span-2">
            {canManage && (
              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Create a campaign</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {STEPS.map((s, i) => (
                        <span key={s} className="flex items-center gap-1.5">
                          <span className="rounded-full bg-surface-overlay px-2.5 py-1 text-[12px] text-ink-secondary">{i + 1}. {s}</span>
                          {i < STEPS.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-ink-tertiary" />}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Link href="/newsletter/campaigns/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[13px] font-semibold text-brand-navy hover:bg-brand-creamSoft"><Send className="h-4 w-4" /> New campaign</Link>
                </div>
              </Card>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Stat icon={CalendarClock} label="Scheduled campaigns" value={d.scheduledCampaigns} href="/newsletter/campaigns?filter=scheduled" tone={d.scheduledCampaigns ? "info" : "muted"} big />
              <Stat icon={FileEdit} label="Draft campaigns" value={d.draftCampaigns} href="/newsletter/campaigns?filter=draft" tone="muted" big />
            </div>

            <Card className="p-5">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Last campaign</div>
                <Link href="/newsletter/campaigns" className="text-[12px] text-ink-tertiary hover:text-ink-secondary">All campaigns →</Link>
              </div>
              {d.lastCampaign ? (
                <Link href={`/newsletter/campaigns/${d.lastCampaign.id}`} className="block">
                  <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink-primary">{d.lastCampaign.name}</span><CampaignStatusPill status={d.lastCampaign.status} /></div>
                  {d.lastCampaign.status === "sent" && (
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[12px]">
                      <div><div className="font-display text-[18px] text-ink-primary">{d.lastCampaign.totals.delivered}</div><div className="text-ink-tertiary">delivered</div></div>
                      <div><div className="font-display text-[18px] text-ink-primary">{rate(d.lastCampaign.totals.opened, d.lastCampaign.totals.delivered)}</div><div className="text-ink-tertiary">open</div></div>
                      <div><div className="font-display text-[18px] text-ink-primary">{rate(d.lastCampaign.totals.clicked, d.lastCampaign.totals.delivered)}</div><div className="text-ink-tertiary">click</div></div>
                    </div>
                  )}
                </Link>
              ) : <p className="text-[13px] text-ink-tertiary">No campaigns yet. Create your first above.</p>}
            </Card>
          </div>

          {/* Audience & consent health + supporting screens */}
          <div className="space-y-4">
            <Card className="p-5">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Audience & consent</div>
              <div className="space-y-2.5">
                <HealthRow icon={Users} label="Active subscribers" value={d.activeSubscribers} href="/newsletter/subscribers?filter=subscribed" />
                <HealthRow icon={ShieldCheck} label="Valid consent" value={d.validConsent} href="/newsletter/subscribers?filter=subscribed" tone="success" />
                <HealthRow icon={ShieldAlert} label="Consent issues" value={d.consentMissing} href="/newsletter/subscribers?filter=consent-missing" tone={d.consentMissing ? "warning" : undefined} />
                <HealthRow icon={UserMinus} label="Unsubscribed / suppressed" value={d.unsubscribedSuppressed} href="/newsletter/subscribers?filter=unsubscribed" />
              </div>
            </Card>

            <Card className="p-5">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Manage</div>
              <div className="space-y-2">
                <Quick icon={Mail} label="Contacts" desc={`${d.totalSubscribers} people`} href="/newsletter/subscribers" />
                <Quick icon={UsersRound} label="Audiences" desc="Lists & rule-based audiences" href="/newsletter/segments" />
                <Quick icon={LayoutTemplate} label="Email designs" desc="Reusable email templates" href="/newsletter/templates" />
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, href, tone, big }: { icon: typeof Users; label: string; value: number; href: string; tone: "info" | "muted"; big?: boolean }) {
  const color = tone === "info" && value ? "text-info" : "text-ink-primary";
  return (
    <Link href={href}>
      <Card className="p-4 transition-colors hover:border-border-strong">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-overlay text-ink-secondary"><Icon className="h-4 w-4" /></span>
        <div className={`mt-2 font-display ${big ? "text-[26px]" : "text-[22px]"} leading-none tabular-nums ${color}`}>{value}</div>
        <div className="mt-1 text-[12px] text-ink-tertiary">{label}</div>
      </Card>
    </Link>
  );
}

function HealthRow({ icon: Icon, label, value, href, tone }: { icon: typeof Users; label: string; value: number; href: string; tone?: "success" | "warning" }) {
  const color = tone === "warning" && value ? "text-warning" : tone === "success" && value ? "text-success" : "text-ink-primary";
  return (
    <Link href={href} className="flex items-center gap-3 rounded-md border border-border-subtle px-3 py-2 transition-colors hover:border-border-strong">
      <Icon className="h-4 w-4 shrink-0 text-ink-tertiary" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{label}</span>
      <span className={`shrink-0 font-display text-[16px] tabular-nums ${color}`}>{value}</span>
    </Link>
  );
}

function Quick({ icon: Icon, label, desc, href }: { icon: typeof Send; label: string; desc: string; href: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-md border border-border-subtle px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-surface-overlay/40">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-navy text-brand-cream"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-ink-primary">{label}</span><span className="block truncate text-[11px] text-ink-tertiary">{desc}</span></span>
      <ArrowRight className="h-4 w-4 shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
