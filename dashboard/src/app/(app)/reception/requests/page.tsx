"use client";

import * as React from "react";
import Link from "next/link";
import { Search, ConciergeBell, ChevronRight, X, Plus } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useAuth } from "@/providers/auth-provider";
import { useRequests, isRequestOverdue, useCreateRequest } from "@/data/reception";
import { useRoomsLite } from "@/data/stays";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { RequestStatusPill, PriorityPill, OverdueBadge } from "@/components/reception/rec-pills";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { relativeTime, cn } from "@/lib/utils";
import type { RequestSummary } from "@/data/reception-types";

type View = "open" | "new" | "in_progress" | "resolved" | "closed" | "cancelled" | "mine" | "unassigned" | "high" | "overdue" | "all";
const VIEWS: [View, string][] = [
  ["open", "Open"], ["new", "New"], ["in_progress", "In progress"], ["overdue", "Overdue"], ["high", "High priority"],
  ["mine", "Assigned to me"], ["unassigned", "Unassigned"], ["resolved", "Resolved"], ["closed", "Closed"], ["cancelled", "Cancelled"], ["all", "All"],
];

export default function RequestsQueue() {
  const { currentHotel } = useHotel();
  const { user } = useAuth();
  const q = useRequests(currentHotel?.id);
  const [view, setView] = React.useState<View>("open");
  const [search, setSearch] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);

  const items = React.useMemo(() => {
    let list = q.data ?? [];
    switch (view) {
      case "open": list = list.filter((r) => ["new", "acknowledged", "in_progress"].includes(r.status)); break;
      case "new": list = list.filter((r) => r.status === "new"); break;
      case "in_progress": list = list.filter((r) => r.status === "in_progress"); break;
      case "resolved": list = list.filter((r) => r.status === "resolved"); break;
      case "closed": list = list.filter((r) => r.status === "closed"); break;
      case "cancelled": list = list.filter((r) => r.status === "cancelled"); break;
      case "mine": list = list.filter((r) => r.assignedTo === user?.id); break;
      case "unassigned": list = list.filter((r) => !r.assignedTo && ["new", "acknowledged", "in_progress"].includes(r.status)); break;
      case "high": list = list.filter((r) => (r.priority === "high" || r.priority === "urgent") && ["new", "acknowledged", "in_progress"].includes(r.status)); break;
      case "overdue": list = list.filter((r) => isRequestOverdue(r)); break;
    }
    if (search.trim()) { const t = search.toLowerCase(); list = list.filter((r) => r.title.toLowerCase().includes(t) || r.requestType.toLowerCase().includes(t) || (r.roomNumber ?? "").includes(t)); }
    return list;
  }, [q.data, view, search, user?.id]);

  const count = (v: View) => {
    const list = q.data ?? [];
    if (v === "overdue") return list.filter(isRequestOverdue).length;
    if (v === "open") return list.filter((r) => ["new", "acknowledged", "in_progress"].includes(r.status)).length;
    if (v === "mine") return list.filter((r) => r.assignedTo === user?.id).length;
    return undefined;
  };

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader
        crumbs={[{ label: "Reception", href: "/reception" }, { label: "Requests" }]}
        title="Requests"
        subtitle="Guest requests for your hotel — a live work queue with an append-only history."
        actions={<Button variant="primary" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> New request</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {VIEWS.map(([v, label]) => {
          const n = count(v);
          return (
            <button key={v} onClick={() => setView(v)}
              className={cn("rounded-full border px-3 py-1 text-[12px] transition-colors", view === v ? "border-brand-goldDeep/50 bg-surface-base text-ink-primary" : "border-border-subtle text-ink-tertiary hover:text-ink-secondary")}>
              {label}{n ? ` · ${n}` : ""}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, type or room…" className="h-8 w-64 pl-8" />
        </div>
        {search && <button onClick={() => setSearch("")} className="flex items-center gap-1 text-[12px] text-ink-tertiary hover:text-ink-secondary"><X className="h-3.5 w-3.5" /> Clear</button>}
      </div>

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <SectionLoader rows={6} />
      ) : items.length === 0 ? (
        <EmptyState icon={ConciergeBell} title={(q.data ?? []).length ? "No requests in this view" : "No requests yet"} hint={(q.data ?? []).length ? "Try another view." : "Guest requests will appear here as they come in."} />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-border-subtle">{items.map((r) => <Row key={r.id} r={r} />)}</div>
        </Card>
      )}

      <NewRequestDialog open={newOpen} onOpenChange={setNewOpen} hotelId={currentHotel?.id} />
    </div>
  );
}

function Row({ r }: { r: RequestSummary }) {
  const overdue = isRequestOverdue(r);
  return (
    <Link href={`/reception/requests/${r.id}`} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-overlay/50">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="truncate font-medium text-ink-primary">{r.title}</span>{overdue && <OverdueBadge />}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-tertiary">
          <span>{r.requestType}</span>{r.roomNumber && <><span>·</span><span>Room {r.roomNumber}</span></>}<span>·</span><span>{relativeTime(r.createdAt)}</span>
          {r.assignedTo && <><span>·</span><span>assigned</span></>}
        </div>
      </div>
      <PriorityPill priority={r.priority} />
      <RequestStatusPill status={r.status} />
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

function NewRequestDialog({ open, onOpenChange, hotelId }: { open: boolean; onOpenChange: (v: boolean) => void; hotelId?: string }) {
  const create = useCreateRequest(hotelId);
  const roomsQ = useRoomsLite(hotelId);
  const [title, setTitle] = React.useState("");
  const [type, setType] = React.useState("front_desk");
  const [priority, setPriority] = React.useState("normal");
  const [roomId, setRoomId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setTitle(""); setType("front_desk"); setPriority("normal"); setRoomId(""); setError(null); } }, [open]);

  const submit = async () => {
    setError(null);
    try { await create.mutateAsync({ title: title.trim() || "Untitled request", requestType: type, priority: priority as any, roomId: roomId || null }); onOpenChange(false); }
    catch (e) { setError(humanizeError(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New request</DialogTitle><DialogDescription>Log a guest request for your team to handle.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Title</label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Extra towels for room 102" autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Type</label>
              <select value={type} onChange={(e) => setType(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">
                {["front_desk", "housekeeping", "maintenance", "concierge", "food_beverage", "other"].map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">
                {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Room (optional)</label>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">
              <option value="">No room</option>
              {(roomsQ.data ?? []).map((r) => <option key={r.id} value={r.id}>Room {r.roomNumber}</option>)}
            </select>
          </div>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={submit} loading={create.isPending} disabled={!title.trim()}>Create</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
