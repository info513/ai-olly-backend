"use client";

import * as React from "react";
import Link from "next/link";
import {
  LogIn, LogOut, BedDouble, MessageSquareWarning, AlertTriangle, ShieldAlert, Sparkles, FileText,
  Images, Send, ArrowRight, Activity, ConciergeBell, PlusCircle, HeartPulse,
} from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useReceptionToday } from "@/data/reception";
import { useHomeAi, useHomeContent } from "@/data/home";
import { useAssetsSummary } from "@/data/assets";
import { useNewsletterSummary } from "@/data/newsletter";
import { useRecentActivity, type ActivityItem } from "@/data/recent-activity";
import { PageHeader } from "@/components/content/page-header";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/utils";

const KIND_ICON: Record<ActivityItem["kind"], typeof FileText> = {
  content: FileText, knowledge: Sparkles, request: ConciergeBell, stay: BedDouble, consent: ShieldAlert, campaign: Send, asset: Images,
};

export default function HomePage() {
  const { currentHotel, profile } = useHotel();
  const { role } = usePermissions();

  const isAdmin = role === "hotel_admin" || role === "platform_admin";
  const show = {
    today: isAdmin || role === "reception",
    ai: isAdmin || role === "editor" || role === "marketing" || role === "read_only",
    content: isAdmin || role === "editor" || role === "marketing" || role === "read_only",
    assets: isAdmin || role === "editor" || role === "marketing" || role === "read_only",
    newsletter: isAdmin || role === "marketing" || role === "read_only",
  };
  const canWrite = role !== "read_only";

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = (profile?.displayName ?? "").split(" ")[0] || "there";

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader
        title={`${greet}, ${name}.`}
        subtitle={`Here's what needs you at ${currentHotel?.name ?? "your hotel"} today.`}
        actions={<Link href="/analytics" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong px-3 text-[13px] font-medium text-ink-secondary hover:text-ink-primary"><Activity className="h-4 w-4" /> Analytics</Link>}
      />

      <div className="space-y-6">
        {show.today && <TodaySection hotelId={currentHotel?.id} />}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {show.ai && <AiSection hotelId={currentHotel?.id} minimal={role === "reception"} />}
            {show.content && <ContentSection hotelId={currentHotel?.id} />}
            {(show.assets || show.newsletter) && <div className="grid gap-6 sm:grid-cols-2">{show.assets && <AssetsSection hotelId={currentHotel?.id} />}{show.newsletter && <NewsletterSection hotelId={currentHotel?.id} />}</div>}
          </div>
          <div className="space-y-6">
            <QuickActions role={role} canWrite={canWrite} />
            <RecentActivitySection hotelId={currentHotel?.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────────
function TodaySection({ hotelId }: { hotelId?: string }) {
  const q = useReceptionToday(hotelId);
  const c = q.data?.counts;
  return (
    <Section title="Today" href="/reception" cta="Open reception">
      {q.isLoading || !c ? <StatRow n={6} /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat icon={LogIn} label="Arriving" value={c.arrivals} href="/reception#arrivals" tone={c.arrivals ? "info" : "muted"} />
          <Stat icon={LogOut} label="Departing" value={c.departures} href="/reception#departures" tone={c.departures ? "info" : "muted"} />
          <Stat icon={BedDouble} label="In house" value={c.active} href="/reception#active" tone="muted" />
          <Stat icon={MessageSquareWarning} label="New requests" value={c.newReq} href="/reception/requests?filter=new" tone={c.newReq ? "warning" : "muted"} />
          <Stat icon={AlertTriangle} label="Overdue" value={c.overdue} href="/reception/requests?filter=overdue" tone={c.overdue ? "danger" : "muted"} />
          <Stat icon={ShieldAlert} label="Consent missing" value={c.consentMissing} href="/reception#consent" tone={c.consentMissing ? "warning" : "muted"} />
        </div>
      )}
    </Section>
  );
}

function AiSection({ hotelId, minimal }: { hotelId?: string; minimal?: boolean }) {
  const q = useHomeAi(hotelId);
  const d = q.data;
  return (
    <Section title="AI" href="/ai" cta="AI home">
      {q.isLoading || !d ? <StatRow n={minimal ? 2 : 4} /> : minimal ? (
        <div className="grid grid-cols-2 gap-3">
          <Stat icon={MessageSquareWarning} label="Unanswered" value={d.unanswered} href="/ai/unanswered" tone={d.unanswered ? "warning" : "muted"} />
          <Stat icon={AlertTriangle} label="Expired critical" value={d.expiredCritical} href="/ai/knowledge?filter=expired-critical" tone={d.expiredCritical ? "danger" : "muted"} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {d.hasDaily && <Stat icon={Sparkles} label="Questions (7d)" value={d.questions7d} href="/analytics/ai" tone="muted" />}
          {d.hasDaily && <Stat icon={Sparkles} label="Handoff rate" value={d.handoffRatePct == null ? "—" : `${d.handoffRatePct}%`} href="/analytics/ai" tone="muted" />}
          <Stat icon={Sparkles} label="Coverage" value={d.coveragePct == null ? "—" : `${d.coveragePct}%`} href="/ai/quality" tone="muted" />
          <Stat icon={MessageSquareWarning} label="Unanswered" value={d.unanswered} href="/ai/unanswered" tone={d.unanswered ? "warning" : "muted"} />
          <Stat icon={AlertTriangle} label="Expired critical" value={d.expiredCritical} href="/ai/knowledge?filter=expired-critical" tone={d.expiredCritical ? "danger" : "muted"} />
        </div>
      )}
    </Section>
  );
}

function ContentSection({ hotelId }: { hotelId?: string }) {
  const q = useHomeContent(hotelId);
  const d = q.data;
  return (
    <Section title="Content" href="/content" cta="Open content">
      {q.isLoading || !d ? <StatRow n={4} /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon={FileText} label="Service drafts" value={d.serviceDrafts} href="/content/services?status=draft" tone={d.serviceDrafts ? "info" : "muted"} />
          <Stat icon={FileText} label="Knowledge drafts" value={d.knowledgeDrafts} href="/ai/knowledge?status=draft" tone={d.knowledgeDrafts ? "info" : "muted"} />
          <Stat icon={AlertTriangle} label="Expired" value={d.serviceExpired + d.knowledgeExpired} href="/content/services" tone={(d.serviceExpired + d.knowledgeExpired) ? "warning" : "muted"} />
          <Stat icon={Sparkles} label="Not AI-visible" value={d.servicesNotAvailableToAi} href="/content/services" tone={d.servicesNotAvailableToAi ? "warning" : "muted"} />
        </div>
      )}
    </Section>
  );
}

function AssetsSection({ hotelId }: { hotelId?: string }) {
  const q = useAssetsSummary(hotelId);
  const d = q.data;
  return (
    <Section title="Assets" href="/assets" cta="Library">
      {q.isLoading || !d ? <StatRow n={2} /> : (
        <div className="grid grid-cols-2 gap-3">
          <Stat icon={Images} label="Unused" value={d.unused.length} href="/assets/usage?filter=unused" tone={d.unused.length ? "warning" : "muted"} />
          <Stat icon={AlertTriangle} label="Missing alt" value={d.missingAlt.length} href="/assets/images?filter=missing-alt" tone={d.missingAlt.length ? "warning" : "muted"} />
        </div>
      )}
    </Section>
  );
}

function NewsletterSection({ hotelId }: { hotelId?: string }) {
  const q = useNewsletterSummary(hotelId);
  const d = q.data;
  return (
    <Section title="Newsletter" href="/newsletter" cta="Open">
      {q.isLoading || !d ? <StatRow n={2} /> : (
        <div className="grid grid-cols-2 gap-3">
          <Stat icon={Send} label="Scheduled" value={d.scheduledCampaigns} href="/newsletter/campaigns?filter=scheduled" tone={d.scheduledCampaigns ? "info" : "muted"} />
          <Stat icon={ShieldAlert} label="Consent missing" value={d.consentMissing} href="/newsletter/subscribers?filter=consent-missing" tone={d.consentMissing ? "warning" : "muted"} />
        </div>
      )}
    </Section>
  );
}

const ACTIONS: { id: string; label: string; icon: typeof PlusCircle; href: string; roles: string[]; write?: boolean }[] = [
  { id: "overdue", label: "View overdue requests", icon: AlertTriangle, href: "/reception/requests?filter=overdue", roles: ["hotel_admin", "platform_admin", "reception"] },
  { id: "new-stay", label: "New stay", icon: PlusCircle, href: "/stays/new", roles: ["hotel_admin", "platform_admin", "reception"], write: true },
  { id: "capture-consent", label: "Capture consent", icon: ShieldAlert, href: "/consent", roles: ["hotel_admin", "platform_admin", "reception"], write: true },
  { id: "review-ai", label: "Review AI questions", icon: MessageSquareWarning, href: "/ai/unanswered", roles: ["hotel_admin", "platform_admin", "editor"] },
  { id: "add-knowledge", label: "Add knowledge answer", icon: Sparkles, href: "/ai/knowledge/new", roles: ["hotel_admin", "platform_admin", "editor"], write: true },
  { id: "add-service", label: "Add a service", icon: PlusCircle, href: "/content/services", roles: ["hotel_admin", "platform_admin", "editor"], write: true },
  { id: "upload-asset", label: "Upload asset", icon: Images, href: "/assets/upload", roles: ["hotel_admin", "platform_admin", "editor", "marketing"], write: true },
  { id: "new-campaign", label: "New campaign", icon: Send, href: "/newsletter/campaigns/new", roles: ["hotel_admin", "platform_admin", "marketing"], write: true },
  { id: "health", label: "Hotel health", icon: HeartPulse, href: "/analytics/health", roles: ["hotel_admin", "platform_admin", "editor", "marketing", "read_only", "reception"] },
];

function QuickActions({ role, canWrite }: { role: string | null; canWrite: boolean }) {
  const items = ACTIONS.filter((a) => role && a.roles.includes(role) && (canWrite || !a.write)).slice(0, 6);
  if (!items.length) return null;
  return (
    <Card className="p-5">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Quick actions</div>
      <div className="space-y-2">
        {items.map((a) => (
          <Link key={a.id} href={a.href} className="group flex items-center gap-3 rounded-md border border-border-subtle px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-surface-overlay/40">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-navy text-brand-cream"><a.icon className="h-4 w-4" /></span>
            <span className="flex-1 text-[13px] font-medium text-ink-primary">{a.label}</span>
            <ArrowRight className="h-4 w-4 shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        ))}
      </div>
    </Card>
  );
}

function RecentActivitySection({ hotelId }: { hotelId?: string }) {
  const q = useRecentActivity(hotelId, 12);
  return (
    <Card className="p-0">
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3"><Activity className="h-4 w-4 text-ink-tertiary" /><span className="text-[13px] font-semibold text-ink-primary">Recent activity</span></div>
      {q.isLoading ? <div className="p-4"><StatRow n={1} /></div> : (q.data ?? []).length === 0 ? <p className="px-4 py-6 text-center text-[13px] text-ink-tertiary">Nothing recent.</p> : (
        <ol className="max-h-[420px] divide-y divide-border-subtle overflow-y-auto">
          {q.data!.map((a) => { const Icon = KIND_ICON[a.kind]; return (
            <li key={a.id}>
              <Link href={a.href ?? "#"} className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-surface-overlay/40">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" />
                <span className="min-w-0 flex-1"><span className="block truncate text-[13px] text-ink-secondary">{a.text}</span><span className="text-[11px] text-ink-tertiary">{relativeTime(a.at)}</span></span>
              </Link>
            </li>
          ); })}
        </ol>
      )}
    </Card>
  );
}

// ── Primitives ────────────────────────────────────────────────────────────────
function Section({ title, href, cta, children }: { title: string; href: string; cta: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-tertiary">{title}</h2>
        <Link href={href} className="text-[12px] text-ink-tertiary hover:text-ink-secondary">{cta} →</Link>
      </div>
      {children}
    </div>
  );
}
function Stat({ icon: Icon, label, value, href, tone }: { icon: typeof LogIn; label: string; value: number | string; href: string; tone: "info" | "warning" | "danger" | "muted" }) {
  const color = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "info" ? "text-info" : "text-ink-primary";
  return (
    <Link href={href}>
      <Card className="p-3.5 transition-colors hover:border-border-strong">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-overlay text-ink-secondary"><Icon className="h-4 w-4" /></span>
        <div className={`mt-2 font-display text-[22px] leading-none tabular-nums ${value ? color : "text-ink-primary"}`}>{value}</div>
        <div className="mt-1 text-[12px] text-ink-tertiary">{label}</div>
      </Card>
    </Link>
  );
}
function StatRow({ n }: { n: number }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">{Array.from({ length: n }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
}
