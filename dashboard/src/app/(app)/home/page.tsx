"use client";

import * as React from "react";
import Link from "next/link";
import {
  LogIn, LogOut, BedDouble, MessageSquareWarning, AlertTriangle, ShieldAlert, Sparkles, FileText,
  Images, Send, ArrowRight, Activity, ConciergeBell, PlusCircle, HeartPulse, Clock, CheckCircle2, ChevronRight,
} from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useReceptionToday, type TodayData, type RequestSummaryLike } from "@/data/reception";
import type { RequestSummary } from "@/data/reception-types";
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

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = (profile?.displayName ?? "").split(" ")[0] || "there";
  const hotelId = currentHotel?.id;

  // Each role opens the workday on the surface it actually starts from.
  const body =
    role === "reception" ? <ReceptionHome hotelId={hotelId} />
    : role === "editor" ? <EditorHome hotelId={hotelId} />
    : role === "marketing" ? <MarketingHome hotelId={hotelId} />
    : role === "read_only" ? <ReadOnlyHome hotelId={hotelId} />
    : <AdminHome hotelId={hotelId} role={role} />; // hotel_admin + platform_admin

  const subtitle =
    role === "reception" ? `Here's what's happening at ${currentHotel?.name ?? "your hotel"} today.`
    : role === "editor" ? "Content and Olly tasks that need you."
    : role === "marketing" ? "Campaigns, audience and consent at a glance."
    : role === "read_only" ? `A read-only overview of ${currentHotel?.name ?? "your hotel"}.`
    : `Here's what needs you at ${currentHotel?.name ?? "your hotel"} today.`;

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader title={`${greet}, ${name}.`} subtitle={subtitle} />
      {body}
    </div>
  );
}

// ── Role homes ────────────────────────────────────────────────────────────────

/** Reception: the operational start of the shift — today's movements and what
 *  blocks a clean check-in/out, each row linking straight to the action. */
function ReceptionHome({ hotelId }: { hotelId?: string }) {
  const q = useReceptionToday(hotelId);
  const d = q.data;
  const loading = q.isLoading || !d;
  const c = d?.counts;
  return (
    <div className="space-y-6">
      {loading || !c ? <StatRow n={6} /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat icon={LogIn} label="Arriving" value={c.arrivals} href="/reception#arrivals" tone={c.arrivals ? "info" : "muted"} />
          <Stat icon={LogOut} label="Departing" value={c.departures} href="/reception#departures" tone={c.departures ? "info" : "muted"} />
          <Stat icon={BedDouble} label="In house" value={c.active} href="/reception#active" tone="muted" />
          <Stat icon={MessageSquareWarning} label="New requests" value={c.newReq} href="/reception/requests?filter=new" tone={c.newReq ? "warning" : "muted"} />
          <Stat icon={AlertTriangle} label="Overdue" value={c.overdue} href="/reception/requests?filter=overdue" tone={c.overdue ? "danger" : "muted"} />
          <Stat icon={ShieldAlert} label="Consent missing" value={c.consentMissing} href="/reception#consent" tone={c.consentMissing ? "warning" : "muted"} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <MovementCard
            title="Arrivals today" icon={LogIn} href="/reception#arrivals"
            loading={loading} items={d?.arrivals ?? []} kind="arrival"
            empty="No arrivals today." />
          <MovementCard
            title="Departures today" icon={LogOut} href="/reception#departures"
            loading={loading} items={d?.departures ?? []} kind="departure"
            empty="No departures today." />
        </div>
        <div className="space-y-6">
          <AttentionCard loading={loading} data={d} />
          <QuickActions role="reception" canWrite />
        </div>
      </div>
    </div>
  );
}

/** Hotel admin: the broad operational overview across the whole hotel. */
function AdminHome({ hotelId, role }: { hotelId?: string; role: string | null }) {
  return (
    <div className="space-y-6">
      <TodaySection hotelId={hotelId} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <AiSection hotelId={hotelId} />
          <ContentSection hotelId={hotelId} />
          <div className="grid gap-6 sm:grid-cols-2">
            <AssetsSection hotelId={hotelId} />
            <NewsletterSection hotelId={hotelId} />
          </div>
        </div>
        <div className="space-y-6">
          <QuickActions role={role} canWrite />
          <RecentActivitySection hotelId={hotelId} />
        </div>
      </div>
    </div>
  );
}

/** Editor: content to finish and questions Olly couldn't answer. */
function EditorHome({ hotelId }: { hotelId?: string }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <ContentSection hotelId={hotelId} />
        <AiSection hotelId={hotelId} />
        <AssetsSection hotelId={hotelId} />
      </div>
      <div className="space-y-6">
        <QuickActions role="editor" canWrite />
        <RecentActivitySection hotelId={hotelId} />
      </div>
    </div>
  );
}

/** Marketing: campaign state, audience and consent health. */
function MarketingHome({ hotelId }: { hotelId?: string }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <NewsletterSection hotelId={hotelId} />
        <AssetsSection hotelId={hotelId} />
      </div>
      <div className="space-y-6">
        <QuickActions role="marketing" canWrite />
        <RecentActivitySection hotelId={hotelId} />
      </div>
    </div>
  );
}

/** Read-only: a safe overview with no write affordances. */
function ReadOnlyHome({ hotelId }: { hotelId?: string }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <AiSection hotelId={hotelId} />
        <ContentSection hotelId={hotelId} />
        <div className="grid gap-6 sm:grid-cols-2">
          <AssetsSection hotelId={hotelId} />
          <NewsletterSection hotelId={hotelId} />
        </div>
      </div>
      <div className="space-y-6">
        <QuickActions role="read_only" canWrite={false} />
        <RecentActivitySection hotelId={hotelId} />
      </div>
    </div>
  );
}

// ── Reception operational cards ───────────────────────────────────────────────

const hhmm = (ts: string | null) => {
  if (!ts) return null;
  const s = String(ts);
  const m = s.match(/T(\d{2}:\d{2})/); // datetime → HH:MM; plain dates have no time
  return m ? m[1] : null;
};

/** Arrivals / departures list. An arrival with missing consent is a check-in
 *  blocker and is flagged inline with a direct "Capture consent" action. */
function MovementCard({
  title, icon: Icon, href, loading, items, kind, empty,
}: {
  title: string; icon: typeof LogIn; href: string; loading: boolean;
  items: RequestSummaryLike[]; kind: "arrival" | "departure"; empty: string;
}) {
  return (
    <ListCard title={title} icon={Icon} href={href} count={items.length}>
      {loading ? <RowsSkeleton n={2} /> : items.length === 0 ? (
        <EmptyRow text={empty} />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {items.map((s) => {
            const time = hhmm(kind === "arrival" ? s.arrivalAt : s.departureAt);
            const blocked = kind === "arrival" && !s.hasConsent;
            return (
              <li key={s.stayId} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-ink-primary">
                      {s.roomNumber ? `Room ${s.roomNumber}` : "No room"}
                    </span>
                    {time && <span className="inline-flex items-center gap-1 text-[11px] text-ink-tertiary"><Clock className="h-3 w-3" />{time}</span>}
                    {blocked && <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">Consent missing</span>}
                  </span>
                  <span className="block truncate text-[12px] text-ink-tertiary">{s.guestName ?? "Guest"}</span>
                </span>
                {blocked && (
                  <Link href={`/consent/capture/${s.stayId}`} className="shrink-0 rounded-md border border-border-subtle px-2.5 py-1 text-[12px] font-medium text-ink-secondary transition-colors hover:border-border-strong hover:text-ink-primary">
                    Capture consent
                  </Link>
                )}
                <Link href={`/stays/${s.stayId}`} aria-label="Open stay" className="shrink-0 text-ink-tertiary transition-colors hover:text-ink-primary">
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </ListCard>
  );
}

/** Everything that needs a decision now: overdue and new requests, plus stays in
 *  house without consent. Each links straight to where the work happens. */
function AttentionCard({ loading, data }: { loading: boolean; data?: TodayData }) {
  const overdue = data?.overdueRequests ?? [];
  const fresh = (data?.newRequests ?? []).filter((r) => !overdue.some((o) => o.id === r.id));
  const consent = data?.consentMissing ?? [];
  const nothing = !loading && overdue.length === 0 && fresh.length === 0 && consent.length === 0;

  return (
    <ListCard title="Needs attention" icon={AlertTriangle}>
      {loading ? <RowsSkeleton n={3} /> : nothing ? (
        <div className="flex items-center gap-2 px-4 py-6 text-[13px] text-ink-tertiary">
          <CheckCircle2 className="h-4 w-4 text-success" /> You're all caught up.
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {overdue.map((r) => <RequestRow key={r.id} r={r} tone="danger" note="Overdue" />)}
          {fresh.map((r) => <RequestRow key={r.id} r={r} tone="warning" note="New" />)}
          {consent.map((s) => (
            <li key={`c-${s.stayId}`}>
              <Link href={`/consent/capture/${s.stayId}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-overlay/40">
                <ShieldAlert className="h-4 w-4 shrink-0 text-warning" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink-primary">Consent missing</span>
                  <span className="block truncate text-[12px] text-ink-tertiary">{[s.roomNumber ? `Room ${s.roomNumber}` : null, s.guestName].filter(Boolean).join(" · ") || "In-house guest"}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ListCard>
  );
}

function RequestRow({ r, tone, note }: { r: RequestSummary; tone: "danger" | "warning"; note: string }) {
  const dot = tone === "danger" ? "text-danger" : "text-warning";
  return (
    <li>
      <Link href={`/reception/requests/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-overlay/40">
        <MessageSquareWarning className={`h-4 w-4 shrink-0 ${dot}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink-primary">{r.title || "Request"}</span>
          <span className="block truncate text-[12px] text-ink-tertiary">{[note, r.roomNumber ? `Room ${r.roomNumber}` : null].filter(Boolean).join(" · ")}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary" />
      </Link>
    </li>
  );
}

// ── KPI-style sections (admin / editor / marketing / read-only) ────────────────
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

function AiSection({ hotelId }: { hotelId?: string }) {
  const q = useHomeAi(hotelId);
  const d = q.data;
  return (
    <Section title="Olly" href="/ai" cta="Open Olly">
      {q.isLoading || !d ? <StatRow n={4} /> : (
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
    <Section title="Hotel Content" href="/content" cta="Open content">
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
    <Section title="Photos & Media" href="/assets" cta="Library">
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
    <Section title="Marketing" href="/newsletter" cta="Open">
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
  { id: "upload-asset", label: "Upload photo", icon: Images, href: "/assets/upload", roles: ["hotel_admin", "platform_admin", "editor", "marketing"], write: true },
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

/** A titled list card with an optional count pill and "view all" link. */
function ListCard({ title, icon: Icon, href, count, children }: { title: string; icon: typeof LogIn; href?: string; count?: number; children: React.ReactNode }) {
  return (
    <Card className="p-0">
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
        <Icon className="h-4 w-4 text-ink-tertiary" />
        <span className="text-[13px] font-semibold text-ink-primary">{title}</span>
        {typeof count === "number" && count > 0 && <span className="rounded-full bg-surface-overlay px-1.5 py-0.5 text-[11px] font-medium text-ink-tertiary tabular-nums">{count}</span>}
        {href && <Link href={href} className="ml-auto text-[12px] text-ink-tertiary hover:text-ink-secondary">View all →</Link>}
      </div>
      {children}
    </Card>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-4 py-6 text-center text-[13px] text-ink-tertiary">{text}</p>;
}
function RowsSkeleton({ n }: { n: number }) {
  return <div className="space-y-2 p-4">{Array.from({ length: n }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
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
