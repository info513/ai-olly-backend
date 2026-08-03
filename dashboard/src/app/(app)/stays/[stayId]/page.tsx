"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { LogIn, LogOut, XCircle, BedDouble, User, CalendarDays, ShieldAlert, ShieldCheck, ConciergeBell, AlertTriangle, ArrowRight, Pencil, Check } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useStay, useUpdateStay, useRoomsLite } from "@/data/stays";
import { useStayRequests } from "@/data/reception";
import { useStayConsents, consentStatusFrom } from "@/data/consents";
import { useFeedback } from "@/data/feedback";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState } from "@/components/content/states";
import { StayStatusPill, RequestStatusPill, ConsentPill, RatingStars } from "@/components/reception/rec-pills";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { relativeTime } from "@/lib/utils";
import type { StayDetail } from "@/data/reception-types";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");
const dInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const toDate = (v: string) => (v ? new Date(v + "T14:00:00Z").toISOString() : null);

export default function StayDetailPage() {
  const { stayId } = useParams<{ stayId: string }>();
  const { currentHotel } = useHotel();
  const sq = useStay(stayId);
  const reqQ = useStayRequests(stayId);
  const consentsQ = useStayConsents(stayId);
  const fbQ = useFeedback(currentHotel?.id);
  const roomsQ = useRoomsLite(currentHotel?.id);
  const stayActions = useUpdateStay(currentHotel?.id);
  const [err, setErr] = React.useState<string | null>(null);
  const [editRoom, setEditRoom] = React.useState(false);
  const [editDates, setEditDates] = React.useState(false);
  const [arr, setArr] = React.useState(""); const [dep, setDep] = React.useState("");

  const run = async (p: Promise<unknown>) => { setErr(null); try { await p; } catch (e) { setErr(humanizeError(e)); } };

  if (sq.isError) return <div className="mx-auto max-w-[1100px] p-6"><ErrorState error={sq.error} onRetry={() => sq.refetch()} /></div>;
  if (sq.isLoading || !sq.data) return <div className="mx-auto max-w-[1100px] p-6"><SectionLoader rows={6} /></div>;
  const s = sq.data;

  const consent = consentStatusFrom(consentsQ.data ?? []);
  const stayFeedback = (fbQ.data ?? []).filter((f) => f.stayId === s.id);
  const openRequests = (reqQ.data ?? []).filter((r) => ["new", "acknowledged", "in_progress"].includes(r.status));

  return (
    <div className="mx-auto max-w-[1100px] p-6">
      <PageHeader
        crumbs={[{ label: "Stays", href: "/stays" }, { label: s.guestName ?? "Stay" }]}
        title={<span className="flex items-center gap-3">{s.guestName ?? "Unassigned guest"} <StayStatusPill status={s.status} /></span>}
        subtitle={<span className="flex items-center gap-2">Room {s.roomNumber ?? "—"} · {fmt(s.arrivalAt)} – {fmt(s.departureAt)}</span>}
        backHref="/stays"
      />

      {err && <p className="mb-4 rounded-md border border-danger/30 bg-danger-soft/40 px-3 py-2 text-[13px] text-danger">{err}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left */}
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-4 text-[13px] font-semibold text-ink-primary">Overview</h2>
            <dl className="space-y-3 text-[13px]">
              <RowItem icon={User} label="Guest">{s.guestId ? <Link href={`/guests/${s.guestId}`} className="text-ink-primary hover:underline">{s.guestName ?? "Guest"}</Link> : <span className="italic text-ink-tertiary">Not linked</span>}</RowItem>
              <RowItem icon={BedDouble} label="Room">
                {editRoom ? (
                  <span className="flex items-center gap-2">
                    <select defaultValue={s.roomId ?? ""} onChange={(e) => run(stayActions.reassignRoom(s.id, e.target.value || null).then(() => setEditRoom(false)))} className="h-8 rounded-md border border-border-strong bg-surface-sunken px-2 text-[13px] text-ink-primary focus-visible:outline-none">
                      <option value="">No room</option>
                      {(roomsQ.data ?? []).map((r) => <option key={r.id} value={r.id}>Room {r.roomNumber}</option>)}
                    </select>
                    <button onClick={() => setEditRoom(false)} className="text-[12px] text-ink-tertiary">Cancel</button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2"><span className="text-ink-primary">{s.roomNumber ? `Room ${s.roomNumber}` : "—"}</span>{s.status !== "checked_out" && s.status !== "cancelled" && <button onClick={() => setEditRoom(true)} className="text-ink-tertiary hover:text-ink-secondary"><Pencil className="h-3.5 w-3.5" /></button>}</span>
                )}
              </RowItem>
              <RowItem icon={CalendarDays} label="Dates">
                {editDates ? (
                  <span className="flex items-center gap-2">
                    <Input type="date" className="h-8 w-36" defaultValue={dInput(s.arrivalAt)} onChange={(e) => setArr(e.target.value)} />
                    <span className="text-ink-tertiary">–</span>
                    <Input type="date" className="h-8 w-36" defaultValue={dInput(s.departureAt)} onChange={(e) => setDep(e.target.value)} />
                    <button onClick={() => run(stayActions.setDates(s.id, toDate(arr || dInput(s.arrivalAt)), toDate(dep || dInput(s.departureAt))).then(() => setEditDates(false)))} className="text-success"><Check className="h-4 w-4" /></button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2"><span className="text-ink-primary">{fmt(s.arrivalAt)} – {fmt(s.departureAt)}</span><button onClick={() => { setArr(dInput(s.arrivalAt)); setDep(dInput(s.departureAt)); setEditDates(true); }} className="text-ink-tertiary hover:text-ink-secondary"><Pencil className="h-3.5 w-3.5" /></button></span>
                )}
              </RowItem>
              {s.externalId && <RowItem icon={CalendarDays} label="Reference"><span className="text-ink-primary">{s.externalId}</span></RowItem>}
            </dl>
          </Card>

          {/* Requests */}
          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3"><span className="flex items-center gap-2 text-[13px] font-semibold text-ink-primary"><ConciergeBell className="h-4 w-4" /> Requests<span className="rounded-full bg-surface-overlay px-1.5 text-[11px] text-ink-tertiary">{reqQ.data?.length ?? 0}</span></span></div>
            {reqQ.isLoading ? <div className="p-4"><SectionLoader rows={1} /></div> : (reqQ.data ?? []).length === 0 ? <p className="px-4 py-5 text-center text-[13px] text-ink-tertiary">No requests for this stay.</p> : (
              <div className="divide-y divide-border-subtle">{reqQ.data!.map((r) => (
                <Link key={r.id} href={`/reception/requests/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-overlay/40"><span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{r.title}</span><span className="text-[11px] text-ink-tertiary">{relativeTime(r.createdAt)}</span><RequestStatusPill status={r.status} /></Link>
              ))}</div>
            )}
          </Card>

          {stayFeedback.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-3 text-[13px] font-semibold text-ink-primary">Feedback</h2>
              <div className="space-y-2">{stayFeedback.map((f) => <div key={f.id} className="flex items-center gap-2"><RatingStars rating={f.rating} /><span className="text-[13px] text-ink-secondary">{f.category ?? "General"}{f.message ? ` — ${f.message}` : ""}</span></div>)}</div>
            </Card>
          )}
        </div>

        {/* Right — status + consent */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <ActionPanel s={s} consent={consent} openRequests={openRequests.length} run={run} actions={stayActions} />

          <Card className="p-5">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Consent</div>
            {consentsQ.isLoading ? <SectionLoader rows={1} /> : consent.hasGranted ? (
              <div className="space-y-2"><ConsentPill hasConsent revoked={consent.revoked} /><Link href={`/consent/${consent.latestConsentId}`} className="block text-[12px] text-ink-tertiary hover:text-ink-secondary">View signed record →</Link></div>
            ) : (
              <div className="space-y-2"><ConsentPill hasConsent={false} />{s.guestId && <Link href={`/consent/capture/${s.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand-cream px-2.5 text-[12px] font-semibold text-brand-navy hover:bg-brand-creamSoft"><ShieldAlert className="h-3.5 w-3.5" /> Capture consent</Link>}</div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function ActionPanel({ s, consent, openRequests, run, actions }: { s: StayDetail; consent: ReturnType<typeof consentStatusFrom>; openRequests: number; run: (p: Promise<unknown>) => void; actions: ReturnType<typeof useUpdateStay> }) {
  const noRoom = !s.roomId;
  const noGuest = !s.guestId;

  if (s.status === "reserved") {
    return (
      <Card className="p-5">
        <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Check in</div>
        <div className="space-y-2">
          <Blocker ok={!noGuest} okText="Guest linked" badText="No guest linked" />
          <Blocker ok={!noRoom} okText={`Room ${s.roomNumber} assigned`} badText="No room assigned" />
          <Blocker ok={consent.hasGranted} okText="Consent on file" badText="Consent not captured yet" warn />
        </div>
        <Button variant="primary" className="mt-4 w-full" disabled={noRoom} loading={actions.isPending} onClick={() => run(actions.checkIn(s.id))}><LogIn className="h-4 w-4" /> Check in</Button>
        {noRoom && <p className="mt-2 text-[11px] text-ink-tertiary">Assign a room before checking in.</p>}
        {!consent.hasGranted && s.guestId && <Link href={`/consent/capture/${s.id}`} className="mt-2 block text-center text-[12px] text-brand-cream hover:underline">Capture consent first →</Link>}
        <button onClick={() => run(actions.cancel(s.id))} className="mt-3 flex w-full items-center justify-center gap-1.5 text-[12px] text-ink-tertiary hover:text-danger"><XCircle className="h-3.5 w-3.5" /> Cancel reservation</button>
      </Card>
    );
  }

  if (s.status === "checked_in") {
    return (
      <Card className="p-5">
        <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Check out</div>
        <div className="space-y-2">
          <Blocker ok={openRequests === 0} okText="No open requests" badText={`${openRequests} open request${openRequests > 1 ? "s" : ""}`} warn />
          <Blocker ok={consent.hasGranted} okText="Consent on file" badText="Consent not captured" warn />
          <div className="flex items-center gap-2 text-[12px] text-ink-tertiary"><CalendarDays className="h-3.5 w-3.5" /> Departure {fmt(s.departureAt)}</div>
        </div>
        {openRequests > 0 && <p className="mt-2 rounded-md border border-warning/30 bg-warning-soft/40 px-2.5 py-1.5 text-[11px] text-warning">Consider resolving open requests before checkout.</p>}
        <Button variant="primary" className="mt-4 w-full" loading={actions.isPending} onClick={() => run(actions.checkOut(s.id))}><LogOut className="h-4 w-4" /> Check out</Button>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Status</div>
      <StayStatusPill status={s.status} />
      <p className="mt-2 text-[12px] text-ink-tertiary">{s.status === "checked_out" ? "This stay is complete." : s.status === "cancelled" ? "This reservation was cancelled." : "No actions available."}</p>
    </Card>
  );
}

function Blocker({ ok, okText, badText, warn }: { ok: boolean; okText: string; badText: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      {ok ? <ShieldCheck className="h-4 w-4 text-success" /> : warn ? <AlertTriangle className="h-4 w-4 text-warning" /> : <XCircle className="h-4 w-4 text-danger" />}
      <span className={ok ? "text-ink-secondary" : warn ? "text-warning" : "text-danger"}>{ok ? okText : badText}</span>
    </div>
  );
}

function RowItem({ icon: Icon, label, children }: { icon: typeof User; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 shrink-0 text-ink-tertiary" />
      <dt className="w-20 shrink-0 text-ink-tertiary">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
