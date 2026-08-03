"use client";

import * as React from "react";
import Link from "next/link";
import { Search, Users, ChevronRight, X, Copy, Plus } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useGuests, useDuplicateSuggestions, useCreateGuest } from "@/data/guests";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { StayStatusPill, ConsentPill } from "@/components/reception/rec-pills";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { relativeTime, cn } from "@/lib/utils";
import type { GuestSummary } from "@/data/reception-types";

type Filter = "all" | "active" | "arriving" | "departing" | "previous" | "consent" | "requests" | "duplicates";
const FILTERS: [Filter, string][] = [
  ["all", "All"], ["active", "In house"], ["arriving", "Arriving"], ["departing", "Departing"],
  ["previous", "Previous"], ["consent", "Consent missing"], ["requests", "Open requests"], ["duplicates", "Possible duplicates"],
];
const today = () => new Date().toISOString().slice(0, 10);

export default function GuestsList() {
  const { currentHotel } = useHotel();
  const q = useGuests(currentHotel?.id);
  const dupQ = useDuplicateSuggestions(currentHotel?.id);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [search, setSearch] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);

  const dupGuestIds = React.useMemo(() => {
    const s = new Set<string>();
    for (const d of dupQ.data ?? []) if (d.status === "pending") { s.add(d.guestId); s.add(d.candidateGuestId); }
    return s;
  }, [dupQ.data]);

  const items = React.useMemo(() => {
    let list = q.data ?? [];
    switch (filter) {
      case "active": list = list.filter((g) => g.stayStatus === "checked_in"); break;
      case "arriving": list = list.filter((g) => g.stayStatus === "reserved" && g.arrivalAt?.slice(0, 10) === today()); break;
      case "departing": list = list.filter((g) => g.stayStatus === "checked_in" && g.departureAt?.slice(0, 10) === today()); break;
      case "previous": list = list.filter((g) => g.stayStatus === "checked_out" || !g.stayStatus); break;
      case "consent": list = list.filter((g) => g.stayStatus === "checked_in" && !g.hasConsent); break;
      case "requests": list = list.filter((g) => (g.openRequests ?? 0) > 0); break;
      case "duplicates": list = list.filter((g) => dupGuestIds.has(g.id)); break;
    }
    if (search.trim()) { const t = search.toLowerCase(); list = list.filter((g) => g.displayName.toLowerCase().includes(t) || (g.roomNumber ?? "").includes(t)); }
    return list;
  }, [q.data, filter, search, dupGuestIds]);

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader
        title="Guests"
        subtitle={`Everyone staying (or who has stayed) at ${currentHotel?.name ?? "your hotel"}.`}
        actions={
          <div className="flex items-center gap-2">
            {(dupQ.data ?? []).some((d) => d.status === "pending") && <Link href="/guests/duplicates" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-warning/40 px-3 text-[13px] font-medium text-warning hover:bg-warning-soft/30"><Copy className="h-4 w-4" /> Review duplicates</Link>}
            <Button variant="primary" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> New guest</Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)} className={cn("rounded-full border px-3 py-1 text-[12px] transition-colors", filter === f ? "border-brand-goldDeep/50 bg-surface-base text-ink-primary" : "border-border-subtle text-ink-tertiary hover:text-ink-secondary")}>{label}</button>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or room…" className="h-8 w-64 pl-8" />
        </div>
        {search && <button onClick={() => setSearch("")} className="flex items-center gap-1 text-[12px] text-ink-tertiary hover:text-ink-secondary"><X className="h-3.5 w-3.5" /> Clear</button>}
      </div>

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <SectionLoader rows={6} />
        : items.length === 0 ? <EmptyState icon={Users} title={(q.data ?? []).length ? "No guests in this view" : "No guests yet"} hint={(q.data ?? []).length ? "Try another filter." : "Add a guest or create a stay to get started."} />
        : <Card className="overflow-hidden p-0"><div className="divide-y divide-border-subtle">{items.map((g) => <Row key={g.id} g={g} isDup={dupGuestIds.has(g.id)} />)}</div></Card>}

      <NewGuestDialog open={newOpen} onOpenChange={setNewOpen} hotelId={currentHotel?.id} />
    </div>
  );
}

function Row({ g, isDup }: { g: GuestSummary; isDup: boolean }) {
  return (
    <Link href={`/guests/${g.id}`} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-overlay/50">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-ink-primary">{g.displayName}</span>
          {g.pseudonymized && <Badge tone="neutral">Pseudonymized</Badge>}
          {isDup && <Badge tone="warning" className="gap-1"><Copy className="h-3 w-3" /> Possible duplicate</Badge>}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-tertiary">
          {g.roomNumber ? <span>Room {g.roomNumber}</span> : <span>No active room</span>}
          {g.preferredLocale && <><span>·</span><span className="uppercase">{g.preferredLocale}</span></>}
          {(g.openRequests ?? 0) > 0 && <><span>·</span><span className="text-warning">{g.openRequests} open</span></>}
          {g.arrivalAt && <><span>·</span><span>{relativeTime(g.arrivalAt)}</span></>}
        </div>
      </div>
      {g.stayStatus && <StayStatusPill status={g.stayStatus} />}
      {g.stayStatus === "checked_in" && <ConsentPill hasConsent={!!g.hasConsent} />}
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

function NewGuestDialog({ open, onOpenChange, hotelId }: { open: boolean; onOpenChange: (v: boolean) => void; hotelId?: string }) {
  const create = useCreateGuest(hotelId);
  const [first, setFirst] = React.useState("");
  const [last, setLast] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [locale, setLocale] = React.useState("en");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setFirst(""); setLast(""); setEmail(""); setPhone(""); setLocale("en"); setError(null); } }, [open]);

  const submit = async () => {
    setError(null);
    try { await create.mutateAsync({ firstName: first.trim() || null, lastName: last.trim() || null, email: email.trim() || null, phone: phone.trim() || null, preferredLocale: locale }); onOpenChange(false); }
    catch (e) { setError(humanizeError(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New guest</DialogTitle><DialogDescription>Minimal details only — you can add more later.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">First name</label><Input value={first} onChange={(e) => setFirst(e.target.value)} autoFocus /></div>
            <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Last name</label><Input value={last} onChange={(e) => setLast(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Email</label><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="guest@example.com" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Phone</label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Locale</label>
              <select value={locale} onChange={(e) => setLocale(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">{["en", "hr", "de", "it", "fr", "es"].map((l) => <option key={l} value={l}>{l}</option>)}</select>
            </div>
          </div>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={submit} loading={create.isPending} disabled={!first.trim() && !last.trim()}>Create guest</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
