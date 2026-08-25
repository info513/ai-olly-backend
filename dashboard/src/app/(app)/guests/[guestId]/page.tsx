"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Mail, Phone, Globe, MapPin, ShieldOff, Copy, BedDouble, ConciergeBell, MessageSquare, FileSignature, CalendarRange, Building2, LogIn, LogOut } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useGuest, usePseudonymizeGuest, useDuplicateSuggestions } from "@/data/guests";
import { useGuestStays, useUpdateStay } from "@/data/stays";
import { useGuestRequests } from "@/data/reception";
import { useGuestConsents } from "@/data/consents";
import { useFeedback } from "@/data/feedback";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState } from "@/components/content/states";
import { StayStatusPill, RequestStatusPill, ConsentPill, RatingStars } from "@/components/reception/rec-pills";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { relativeTime } from "@/lib/utils";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");
const OPEN_REQ = ["new", "acknowledged", "in_progress"];

export default function GuestProfile() {
  const { guestId } = useParams<{ guestId: string }>();
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const gq = useGuest(guestId);
  const staysQ = useGuestStays(guestId);
  const reqQ = useGuestRequests(guestId);
  const consentsQ = useGuestConsents(guestId);
  const fbQ = useFeedback(currentHotel?.id);
  const dupQ = useDuplicateSuggestions(currentHotel?.id);
  const pseudonymize = usePseudonymizeGuest(currentHotel?.id);
  const stayUpd = useUpdateStay(currentHotel?.id);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const mayPseudonymize = role === "platform_admin" || role === "hotel_admin";

  if (gq.isError) return <div className="mx-auto max-w-[1100px] p-6"><ErrorState error={gq.error} onRetry={() => gq.refetch()} /></div>;
  if (gq.isLoading || !gq.data) return <div className="mx-auto max-w-[1100px] p-6"><SectionLoader rows={6} /></div>;
  const g = gq.data;

  const stays = staysQ.data ?? [];
  const stayIds = new Set(stays.map((s) => s.id));
  const guestFeedback = (fbQ.data ?? []).filter((f) => f.stayId && stayIds.has(f.stayId));
  const dups = (dupQ.data ?? []).filter((dd) => (dd.guestId === guestId || dd.candidateGuestId === guestId) && dd.status === "pending");
  // The stay that matters now: in-house first, then an upcoming reservation.
  const activeStay = stays.find((s) => s.status === "checked_in") ?? stays.find((s) => s.status === "reserved");
  const latestConsent = (consentsQ.data ?? [])[0];
  const consentGranted = latestConsent?.status === "granted";
  const openReq = (reqQ.data ?? []).filter((r) => OPEN_REQ.includes(r.status));
  const bookingSource = activeStay?.externalSource ?? g.externalSource ?? "Manual";

  const runStay = async (fn: () => Promise<unknown>) => {
    setErr(null); setBusy(true);
    try { await fn(); } catch (e) { setErr(humanizeError(e)); } finally { setBusy(false); }
  };
  const doPseudonymize = async () => {
    setErr(null);
    try { await pseudonymize.mutateAsync(guestId); setConfirmOpen(false); }
    catch (e) { setErr(humanizeError(e)); }
  };

  return (
    <div className="mx-auto max-w-[1100px] p-6">
      <PageHeader
        crumbs={[{ label: "Guests", href: "/guests" }, { label: g.displayName }]}
        title={<span className="flex items-center gap-3">{g.displayName}{g.pseudonymized && <Badge tone="neutral">Pseudonymized</Badge>}</span>}
        subtitle={g.pseudonymized ? "Personal data was removed for privacy; stay history is retained." : undefined}
        backHref="/guests"
        actions={mayPseudonymize && !g.pseudonymized && <Button variant="ghost" onClick={() => setConfirmOpen(true)}><ShieldOff className="h-4 w-4" /> Pseudonymize</Button>}
      />

      {/* Human-first summary: who, where, when, status — at a glance. */}
      <div className="mb-5 flex flex-wrap items-center gap-2 text-[13px]">
        {activeStay ? (
          <>
            <SummaryChip icon={BedDouble}>{activeStay.roomNumber ? `Room ${activeStay.roomNumber}` : "No room"}</SummaryChip>
            <SummaryChip icon={CalendarRange}>{fmtDate(activeStay.arrivalAt)} – {fmtDate(activeStay.departureAt)}</SummaryChip>
            <StayStatusPill status={activeStay.status} />
          </>
        ) : (
          <span className="text-ink-tertiary">No current stay</span>
        )}
        <ConsentPill hasConsent={consentGranted} revoked={latestConsent?.status === "revoked"} />
        {openReq.length > 0 && <SummaryChip icon={ConciergeBell} tone="warning">{openReq.length} open request{openReq.length > 1 ? "s" : ""}</SummaryChip>}
        <SummaryChip icon={Building2}>{bookingSource}</SummaryChip>
      </div>

      {err && <p className="mb-4 text-[12px] text-danger">{err}</p>}
      {dups.length > 0 && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-soft/30 px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] text-warning"><Copy className="h-4 w-4" /> {dups.length} possible duplicate{dups.length > 1 ? "s" : ""} to review.</span>
          <Link href="/guests/duplicates" className="text-[12px] font-medium text-warning hover:underline">Review →</Link>
        </div>
      )}

      {/* Current stay — the operational focus, with the actions reception needs. */}
      {activeStay && (
        <Card className="mb-6 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Current stay</div>
              <div className="mt-1.5 flex items-center gap-2"><span className="font-display text-[18px] text-ink-primary">Room {activeStay.roomNumber ?? "—"}</span><StayStatusPill status={activeStay.status} /></div>
              <div className="mt-1 text-[13px] text-ink-secondary">{fmtDate(activeStay.arrivalAt)} – {fmtDate(activeStay.departureAt)}</div>
              <div className="mt-1 text-[12px] text-ink-tertiary">Booking source: {bookingSource}{activeStay.externalId ? ` · ${activeStay.externalId}` : ""}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!consentGranted && (
                <Button asChild variant="primary"><Link href={`/consent/capture/${activeStay.id}`}><FileSignature className="h-4 w-4" /> Capture consent</Link></Button>
              )}
              {activeStay.status === "reserved" && (
                <Button variant={consentGranted ? "primary" : "secondary"} loading={busy} onClick={() => runStay(() => stayUpd.checkIn(activeStay.id))}><LogIn className="h-4 w-4" /> Check in</Button>
              )}
              {activeStay.status === "checked_in" && (
                <Button variant="secondary" loading={busy} onClick={() => runStay(() => stayUpd.checkOut(activeStay.id))}><LogOut className="h-4 w-4" /> Check out</Button>
              )}
              <Button asChild variant="ghost"><Link href={`/stays/${activeStay.id}`}>Open stay</Link></Button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Left — identity & consent state */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Contact</div>
            {g.pseudonymized ? (
              <p className="text-[13px] italic text-ink-tertiary">Contact details were removed.</p>
            ) : (
              <dl className="space-y-2.5 text-[13px]">
                <Info icon={Mail} label="Email" value={g.email} />
                <Info icon={Phone} label="Phone" value={g.phone} />
                <Info icon={Globe} label="Locale" value={g.preferredLocale?.toUpperCase() ?? null} />
                <Info icon={MapPin} label="Country" value={g.countryCode} />
              </dl>
            )}
            {g.externalSource && <div className="mt-3 text-[11px] text-ink-tertiary">Source: {g.externalSource}</div>}
          </Card>

          <Card className="p-5">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Consent</div>
            {consentsQ.isLoading ? <SectionLoader rows={1} /> : latestConsent ? (
              <div className="space-y-2">
                <ConsentPill hasConsent={latestConsent.status === "granted"} revoked={latestConsent.status === "revoked"} />
                <Link href={`/consent/${latestConsent.id}`} className="block text-[12px] text-ink-tertiary hover:text-ink-secondary">{latestConsent.consentType} v{latestConsent.consentVersion} · {fmtDate(latestConsent.signedAt)} → view signed record</Link>
              </div>
            ) : (
              <div className="space-y-2"><ConsentPill hasConsent={false} />{activeStay && <Link href={`/consent/capture/${activeStay.id}`} className="block text-[12px] font-medium text-brand-cream hover:underline">Capture consent →</Link>}</div>
            )}
          </Card>
        </div>

        {/* Right — stay history & contextual activity */}
        <div className="space-y-4">
          <Panel icon={BedDouble} title="Stay history" count={stays.length}>
            {staysQ.isLoading ? <SectionLoader rows={2} /> : stays.length === 0 ? <Empty>No stays recorded.</Empty> : (
              <div className="divide-y divide-border-subtle">
                {stays.map((s) => (
                  <Link key={s.id} href={`/stays/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-overlay/40">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-ink-primary">Room {s.roomNumber ?? "—"}</div>
                      <div className="text-[12px] text-ink-tertiary">{fmtDate(s.arrivalAt)} – {fmtDate(s.departureAt)}{s.externalSource ? ` · ${s.externalSource}` : ""}</div>
                    </div>
                    <StayStatusPill status={s.status} />
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel icon={ConciergeBell} title="Requests" count={reqQ.data?.length}>
            {reqQ.isLoading ? <SectionLoader rows={1} /> : (reqQ.data ?? []).length === 0 ? <Empty>No requests.</Empty> : (
              <div className="divide-y divide-border-subtle">
                {reqQ.data!.map((r) => (
                  <Link key={r.id} href={`/reception/requests/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-overlay/40">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{r.title}</span>
                    <span className="text-[11px] text-ink-tertiary">{relativeTime(r.createdAt)}</span>
                    <RequestStatusPill status={r.status} />
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel icon={FileSignature} title="Consent & signatures" count={consentsQ.data?.length}>
            {consentsQ.isLoading ? <SectionLoader rows={1} /> : (consentsQ.data ?? []).length === 0 ? <Empty>No consent records.</Empty> : (
              <div className="divide-y divide-border-subtle">
                {consentsQ.data!.map((c) => (
                  <Link key={c.id} href={`/consent/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-overlay/40">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{c.consentType} v{c.consentVersion}</span>
                    <span className="text-[11px] text-ink-tertiary">{fmtDate(c.signedAt)}</span>
                    <ConsentPill hasConsent={c.status === "granted"} revoked={c.status === "revoked"} />
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel icon={MessageSquare} title="Feedback" count={guestFeedback.length}>
            {fbQ.isLoading ? <SectionLoader rows={1} /> : guestFeedback.length === 0 ? <Empty>No feedback.</Empty> : (
              <div className="divide-y divide-border-subtle">
                {guestFeedback.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                    <RatingStars rating={f.rating} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{f.category ?? "General"}{f.message ? ` — ${f.message}` : ""}</span>
                    <span className="text-[11px] text-ink-tertiary">{relativeTime(f.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Pseudonymize this guest?</DialogTitle><DialogDescription>This permanently removes name, email, phone and external id. Stays and history stay linked for records. This cannot be undone.</DialogDescription></DialogHeader>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button><Button variant="primary" onClick={doPseudonymize} loading={pseudonymize.isPending}><ShieldOff className="h-4 w-4" /> Pseudonymize</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryChip({ icon: Icon, children, tone }: { icon: typeof Mail; children: React.ReactNode; tone?: "warning" }) {
  const cls = tone === "warning" ? "border-warning/40 text-warning" : "border-border-subtle text-ink-secondary";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${cls}`}>
      <Icon className="h-3.5 w-3.5" />{children}
    </span>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="h-4 w-4 shrink-0 text-ink-tertiary" />
      <span className="w-16 shrink-0 text-ink-tertiary">{label}</span>
      <span className="min-w-0 flex-1 truncate text-ink-primary">{value ?? <span className="italic text-ink-tertiary">—</span>}</span>
    </div>
  );
}

function Panel({ icon: Icon, title, count, children }: { icon: typeof BedDouble; title: string; count?: number; children: React.ReactNode }) {
  return (
    <Card className="p-0">
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
        <Icon className="h-4 w-4 text-ink-tertiary" />
        <span className="text-[13px] font-semibold text-ink-primary">{title}</span>
        {count != null && <span className="rounded-full bg-surface-overlay px-1.5 text-[11px] text-ink-tertiary">{count}</span>}
      </div>
      {children}
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-5 text-center text-[13px] text-ink-tertiary">{children}</p>;
}
