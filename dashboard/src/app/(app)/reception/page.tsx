"use client";

import Link from "next/link";
import { LogIn, LogOut, BedDouble, MessageSquareWarning, AlertTriangle, ShieldAlert, Star, ArrowRight, ConciergeBell, ClipboardList } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useReceptionToday, type RequestSummaryLike } from "@/data/reception";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState } from "@/components/content/states";
import { RequestStatusPill, PriorityPill, OverdueBadge, RatingStars } from "@/components/reception/rec-pills";
import { Card } from "@/components/ui/card";
import { relativeTime } from "@/lib/utils";
import type { RequestSummary } from "@/data/reception-types";

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");

export default function ReceptionToday() {
  const { currentHotel } = useHotel();
  const q = useReceptionToday(currentHotel?.id);

  if (q.isError) return <div className="mx-auto max-w-[1200px] p-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;

  const d = q.data;
  const c = d?.counts;

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader
        title="Reception"
        subtitle={`Today at ${currentHotel?.name ?? "your hotel"} — what needs handling right now.`}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/stays/new" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong px-3 text-[13px] font-medium text-ink-secondary hover:text-ink-primary"><ClipboardList className="h-4 w-4" /> New stay</Link>
            <Link href="/reception/requests" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[13px] font-semibold text-brand-navy hover:bg-brand-creamSoft"><ConciergeBell className="h-4 w-4" /> All requests</Link>
          </div>
        }
      />

      {q.isLoading || !d ? (
        <SectionLoader rows={6} />
      ) : (
        <>
          {/* Priority strip */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Arriving" value={c!.arrivals} icon={LogIn} href="#arrivals" tone={c!.arrivals ? "info" : "muted"} />
            <Stat label="Departing" value={c!.departures} icon={LogOut} href="#departures" tone={c!.departures ? "info" : "muted"} />
            <Stat label="In house" value={c!.active} icon={BedDouble} href="#active" tone="muted" />
            <Stat label="New requests" value={c!.newReq} icon={MessageSquareWarning} href="#requests" tone={c!.newReq ? "warning" : "muted"} />
            <Stat label="Overdue" value={c!.overdue} icon={AlertTriangle} href="#requests" tone={c!.overdue ? "danger" : "muted"} />
            <Stat label="Consent missing" value={c!.consentMissing} icon={ShieldAlert} href="#consent" tone={c!.consentMissing ? "warning" : "muted"} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Requests needing attention */}
            <Section id="requests" title="Requests needing attention" count={d.overdueRequests.length + d.newRequests.length} href="/reception/requests">
              {d.overdueRequests.length === 0 && d.newRequests.length === 0 ? (
                <Empty>No new or overdue requests. </Empty>
              ) : (
                <div className="divide-y divide-border-subtle">
                  {[...d.overdueRequests, ...d.newRequests.filter((n) => !d.overdueRequests.some((o) => o.id === n.id))].slice(0, 8).map((r) => <RequestRow key={r.id} r={r} overdue={d.overdueRequests.some((o) => o.id === r.id)} />)}
                </div>
              )}
            </Section>

            {/* Arrivals */}
            <Section id="arrivals" title="Arriving today" count={d.arrivals.length}>
              {d.arrivals.length === 0 ? <Empty>No arrivals scheduled today.</Empty> : (
                <div className="divide-y divide-border-subtle">{d.arrivals.map((s) => <StayRow key={s.stayId} s={s} kind="arrival" />)}</div>
              )}
            </Section>

            {/* Departures */}
            <Section id="departures" title="Departing today" count={d.departures.length}>
              {d.departures.length === 0 ? <Empty>No departures today.</Empty> : (
                <div className="divide-y divide-border-subtle">{d.departures.map((s) => <StayRow key={s.stayId} s={s} kind="departure" />)}</div>
              )}
            </Section>

            {/* Consent missing */}
            <Section id="consent" title="In-house without consent" count={d.consentMissing.length}>
              {d.consentMissing.length === 0 ? <Empty>Every in-house stay has consent on file.</Empty> : (
                <div className="divide-y divide-border-subtle">{d.consentMissing.map((s) => <StayRow key={s.stayId} s={s} kind="consent" />)}</div>
              )}
            </Section>

            {/* Active stays */}
            <Section id="active" title="In house" count={d.activeStays.length}>
              {d.activeStays.length === 0 ? <Empty>No active stays.</Empty> : (
                <div className="divide-y divide-border-subtle">{d.activeStays.slice(0, 8).map((s) => <StayRow key={s.stayId} s={s} kind="active" />)}</div>
              )}
            </Section>

            {/* Recent feedback */}
            <Section id="feedback" title="Recent feedback" count={d.recentFeedback.length} href="/reception/feedback">
              {d.recentFeedback.length === 0 ? <Empty>No feedback yet.</Empty> : (
                <div className="divide-y divide-border-subtle">
                  {d.recentFeedback.map((f) => (
                    <Link key={f.id} href="/reception/feedback" className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-overlay/40">
                      <RatingStars rating={f.rating} />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{f.category ?? "General"}</span>
                      {f.followUp && <span className="rounded bg-warning-soft/50 px-1.5 py-0.5 text-[10px] font-medium text-warning">Follow up</span>}
                      <span className="shrink-0 text-[11px] text-ink-tertiary">{relativeTime(f.createdAt)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, icon: Icon, href, tone }: { label: string; value: number; icon: typeof LogIn; href: string; tone: "info" | "warning" | "danger" | "muted" }) {
  const color = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "info" ? "text-info" : "text-ink-primary";
  return (
    <a href={href}>
      <Card className="p-3.5 transition-colors hover:border-border-strong">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-overlay text-ink-secondary"><Icon className="h-4 w-4" /></span>
        <div className={`mt-2 font-display text-[24px] leading-none tabular-nums ${value ? color : "text-ink-tertiary"}`}>{value}</div>
        <div className="mt-1 text-[12px] text-ink-tertiary">{label}</div>
      </Card>
    </a>
  );
}

function Section({ id, title, count, href, children }: { id: string; title: string; count: number; href?: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-20 p-0">
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-primary">{title}<span className="rounded-full bg-surface-overlay px-1.5 text-[11px] text-ink-tertiary">{count}</span></span>
        {href && <Link href={href} className="text-[12px] text-ink-tertiary hover:text-ink-secondary">View all →</Link>}
      </div>
      {children}
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-center text-[13px] text-ink-tertiary">{children}</p>;
}

function RequestRow({ r, overdue }: { r: RequestSummary; overdue: boolean }) {
  return (
    <Link href={`/reception/requests/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-overlay/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="truncate text-[13px] font-medium text-ink-primary">{r.title}</span>{overdue && <OverdueBadge />}</div>
        <div className="mt-0.5 text-[12px] text-ink-tertiary">{r.roomNumber ? `Room ${r.roomNumber} · ` : ""}{r.requestType} · {relativeTime(r.createdAt)}</div>
      </div>
      <PriorityPill priority={r.priority} />
      <RequestStatusPill status={r.status} />
    </Link>
  );
}

function StayRow({ s, kind }: { s: RequestSummaryLike; kind: "arrival" | "departure" | "active" | "consent" }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ink-primary">{s.guestName ?? "Guest"}</div>
        <div className="mt-0.5 text-[12px] text-ink-tertiary">
          Room {s.roomNumber ?? "—"}
          {kind === "arrival" && s.arrivalAt && ` · arr ${time(s.arrivalAt)}`}
          {kind === "departure" && s.departureAt && ` · dep ${time(s.departureAt)}`}
          {!s.hasConsent && kind !== "consent" && " · no consent"}
        </div>
      </div>
      {kind === "consent" ? (
        <Link href={`/consent/capture/${s.stayId}`} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand-cream px-2.5 text-[12px] font-semibold text-brand-navy hover:bg-brand-creamSoft"><ShieldAlert className="h-3.5 w-3.5" /> Capture</Link>
      ) : (
        <Link href={`/stays/${s.stayId}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-2.5 text-[12px] text-ink-secondary hover:text-ink-primary">{kind === "arrival" ? "Check in" : kind === "departure" ? "Check out" : "Open"} <ArrowRight className="h-3.5 w-3.5" /></Link>
      )}
    </div>
  );
}
