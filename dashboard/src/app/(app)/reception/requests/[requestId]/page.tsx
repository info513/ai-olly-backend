"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Lock, MessageCircle, Send, Check, RotateCcw, UserCheck, CircleDot, PlusCircle } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useAuth } from "@/providers/auth-provider";
import { useRequest, useRequestEvents, useRequestActions, isRequestOverdue } from "@/data/reception";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState } from "@/components/content/states";
import { RequestStatusPill, PriorityPill, OverdueBadge } from "@/components/reception/rec-pills";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/utils";
import { REQUEST_STATUS_LABEL, type RequestEvent, type RequestPriority, type RequestStatus } from "@/data/reception-types";

const NEXT: Record<RequestStatus, { status: RequestStatus; label: string; icon: typeof Check }[]> = {
  new: [{ status: "acknowledged", label: "Acknowledge", icon: UserCheck }, { status: "in_progress", label: "Begin work", icon: CircleDot }],
  acknowledged: [{ status: "in_progress", label: "Begin work", icon: CircleDot }, { status: "resolved", label: "Resolve", icon: Check }],
  in_progress: [{ status: "resolved", label: "Resolve", icon: Check }],
  resolved: [{ status: "closed", label: "Close", icon: Check }, { status: "in_progress", label: "Reopen", icon: RotateCcw }],
  closed: [{ status: "in_progress", label: "Reopen", icon: RotateCcw }],
  cancelled: [{ status: "in_progress", label: "Reopen", icon: RotateCcw }],
};

export default function RequestDetail() {
  const { requestId } = useParams<{ requestId: string }>();
  const { currentHotel } = useHotel();
  const { user } = useAuth();
  const rq = useRequest(requestId);
  const evq = useRequestEvents(requestId);
  const actions = useRequestActions(currentHotel?.id);
  const [note, setNote] = React.useState("");
  const [reply, setReply] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);

  const run = async (p: Promise<unknown>) => { setErr(null); try { await p; } catch (e) { setErr(humanizeError(e)); } };

  if (rq.isError) return <div className="mx-auto max-w-[1200px] p-6"><ErrorState error={rq.error} onRetry={() => rq.refetch()} /></div>;
  if (rq.isLoading || !rq.data) return <div className="mx-auto max-w-[1200px] p-6"><SectionLoader rows={6} /></div>;
  const r = rq.data;
  const hotelId = currentHotel?.id ?? r.hotelId;
  const overdue = isRequestOverdue(r);
  const mine = r.assignedTo === user?.id;

  return (
    <div className="mx-auto max-w-[1100px] p-6">
      <PageHeader
        crumbs={[{ label: "Reception", href: "/reception" }, { label: "Requests", href: "/reception/requests" }, { label: r.title }]}
        title={<span className="flex items-center gap-3">{r.title} {overdue && <OverdueBadge />}</span>}
        subtitle={<span className="flex items-center gap-2">{r.requestType}{r.roomNumber ? ` · Room ${r.roomNumber}` : ""} · opened {relativeTime(r.createdAt)}</span>}
        backHref="/reception/requests"
        actions={<span className="flex items-center gap-2"><PriorityPill priority={r.priority} /><RequestStatusPill status={r.status} /></span>}
      />

      {err && <p className="mb-4 rounded-md border border-danger/30 bg-danger-soft/40 px-3 py-2 text-[13px] text-danger">{err}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left — description + timeline */}
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-2 text-[13px] font-semibold text-ink-primary">Request</h2>
            <p className="text-[14px] text-ink-secondary">{r.description || <span className="italic text-ink-tertiary">No description.</span>}</p>
            {r.guestVisibleResponse && (
              <div className="mt-4 rounded-md border border-success/30 bg-success-soft/30 px-3 py-2">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-success"><MessageCircle className="h-3.5 w-3.5" /> Reply sent to guest</div>
                <p className="text-[13px] text-ink-secondary">{r.guestVisibleResponse}</p>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-[13px] font-semibold text-ink-primary">Timeline</h2>
            {evq.isLoading ? <SectionLoader rows={3} /> : <Timeline events={evq.data ?? []} />}
          </Card>
        </div>

        {/* Right — actions */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card className="p-5">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Move it forward</div>
            <div className="flex flex-wrap gap-2">
              {(NEXT[r.status] ?? []).map((n) => (
                <Button key={n.status + n.label} variant={n.status === "resolved" || n.status === "closed" ? "primary" : "secondary"} size="sm" loading={actions.setStatus.isPending} onClick={() => run(actions.setStatus.mutateAsync({ id: r.id, status: n.status }))}>
                  <n.icon className="h-4 w-4" /> {n.label}
                </Button>
              ))}
              {["new", "acknowledged", "in_progress"].includes(r.status) && (
                <Button variant="ghost" size="sm" onClick={() => run(actions.setStatus.mutateAsync({ id: r.id, status: "cancelled" }))}>Cancel</Button>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Assignment</div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] text-ink-secondary">{r.assignedTo ? (mine ? "Assigned to you" : "Assigned") : "Unassigned"}</span>
              {mine ? (
                <Button variant="ghost" size="sm" onClick={() => run(actions.assign.mutateAsync({ id: r.id, hotelId, assignee: null }))}>Unassign</Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => run(actions.assign.mutateAsync({ id: r.id, hotelId, assignee: user?.id ?? null }))}><UserCheck className="h-4 w-4" /> Assign to me</Button>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Priority</div>
            <div className="flex flex-wrap gap-1.5">
              {(["low", "normal", "high", "urgent"] as RequestPriority[]).map((p) => (
                <button key={p} onClick={() => run(actions.setPriority.mutateAsync({ id: r.id, priority: p }))}
                  className={`rounded-md border px-2.5 py-1 text-[12px] capitalize ${r.priority === p ? "border-brand-goldDeep/50 bg-surface-base text-ink-primary" : "border-border-subtle text-ink-tertiary hover:text-ink-secondary"}`}>{p}</button>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary"><Lock className="h-3.5 w-3.5" /> Internal note</div>
            <p className="mb-2 text-[11px] text-ink-tertiary">Staff-only — never shown to the guest.</p>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add a private note…" className="w-full resize-y rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none" />
            <Button variant="secondary" size="sm" className="mt-2 w-full" disabled={!note.trim()} loading={actions.addInternalNote.isPending} onClick={() => run(actions.addInternalNote.mutateAsync({ id: r.id, hotelId, note: note.trim() }).then(() => setNote("")))}><PlusCircle className="h-4 w-4" /> Add internal note</Button>
          </Card>

          <Card className="p-5">
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary"><MessageCircle className="h-3.5 w-3.5" /> Reply to guest</div>
            <p className="mb-2 text-[11px] text-ink-tertiary">Visible to the guest. Replaces the current reply.</p>
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="Write a guest-visible reply…" className="w-full resize-y rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none" />
            <Button variant="primary" size="sm" className="mt-2 w-full" disabled={!reply.trim()} loading={actions.addGuestReply.isPending} onClick={() => run(actions.addGuestReply.mutateAsync({ id: r.id, hotelId, reply: reply.trim() }).then(() => setReply("")))}><Send className="h-4 w-4" /> Send reply</Button>
          </Card>

          {r.stayId && <Link href={`/stays/${r.stayId}`} className="block text-center text-[12px] text-ink-tertiary hover:text-ink-secondary">Open the related stay →</Link>}
        </div>
      </div>
    </div>
  );
}

const EVENT_LABEL: Record<RequestEvent["eventType"], string> = {
  created: "Request created", acknowledged: "Acknowledged", assigned: "Assignment changed", status_change: "Status changed",
  internal_note: "Internal note", guest_reply: "Reply sent to guest", resolved: "Resolved", reopened: "Reopened",
};

function Timeline({ events }: { events: RequestEvent[] }) {
  if (!events.length) return <p className="text-[13px] italic text-ink-tertiary">No activity yet.</p>;
  return (
    <ol className="space-y-3">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3">
          <div className="mt-1 flex flex-col items-center">
            <span className={`h-2 w-2 shrink-0 rounded-full ${e.isInternal ? "bg-ink-tertiary" : e.eventType === "guest_reply" ? "bg-success" : "bg-brand-cream"}`} />
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-ink-primary">{EVENT_LABEL[e.eventType]}</span>
              {e.toStatus && e.eventType === "status_change" && <span className="text-[12px] text-ink-tertiary">→ {REQUEST_STATUS_LABEL[e.toStatus]}</span>}
              {e.isInternal && <span className="inline-flex items-center gap-1 rounded bg-surface-overlay px-1.5 py-0.5 text-[10px] text-ink-tertiary"><Lock className="h-2.5 w-2.5" /> internal</span>}
              {e.eventType === "guest_reply" && <span className="rounded bg-success-soft/50 px-1.5 py-0.5 text-[10px] font-medium text-success">guest-visible</span>}
            </div>
            {e.note && <p className="mt-0.5 text-[13px] text-ink-secondary">{e.note}</p>}
            <p className="mt-0.5 text-[11px] text-ink-tertiary">{relativeTime(e.createdAt)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
