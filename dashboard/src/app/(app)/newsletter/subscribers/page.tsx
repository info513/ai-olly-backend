"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search, Users, ChevronRight, X, Plus } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useSubscribers, useCreateSubscriber } from "@/data/subscribers";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState, PermissionDenied } from "@/components/content/states";
import { SubscriberStatusPill, ConsentPill } from "@/components/newsletter/nl-pills";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { relativeTime, cn } from "@/lib/utils";
import type { Subscriber, SubscriberStatus } from "@/data/newsletter-types";

const FILTERS: [string, string][] = [
  ["all", "All"], ["subscribed", "Subscribed"], ["pending", "Pending"], ["unsubscribed", "Unsubscribed"],
  ["bounced", "Bounced"], ["complained", "Complained"], ["suppressed", "Suppressed"], ["consent-missing", "Consent missing"],
];

export default function SubscribersList() {
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const params = useSearchParams();
  const q = useSubscribers(currentHotel?.id);
  const [filter, setFilter] = React.useState(params.get("filter") ?? "all");
  const [search, setSearch] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);

  const canManage = role === "platform_admin" || role === "hotel_admin" || role === "marketing";
  const canRead = canManage || role === "reception";

  const items = React.useMemo(() => {
    let list = q.data ?? [];
    if (filter === "consent-missing") list = list.filter((s) => s.status === "subscribed" && s.consentState !== "active");
    else if (filter !== "all") list = list.filter((s) => s.status === (filter as SubscriberStatus));
    if (search.trim()) { const t = search.toLowerCase(); list = list.filter((s) => s.email.toLowerCase().includes(t) || `${s.firstName ?? ""} ${s.lastName ?? ""}`.toLowerCase().includes(t)); }
    return list;
  }, [q.data, filter, search]);

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader
        crumbs={[{ label: "Marketing", href: "/newsletter" }, { label: "Contacts" }]}
        title="Contacts"
        subtitle="Consent-linked marketing subscribers. A stay is never treated as consent."
        actions={canManage && <Button variant="primary" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> Add subscriber</Button>}
        backHref="/newsletter"
      />

      {!canRead ? <PermissionDenied message="Your role can’t view subscriber lists. Templates and campaign summaries may still be available." /> : (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {FILTERS.map(([f, label]) => (
              <button key={f} onClick={() => setFilter(f)} className={cn("rounded-full border px-3 py-1 text-[12px] transition-colors", filter === f ? "border-brand-goldDeep/50 bg-surface-base text-ink-primary" : "border-border-subtle text-ink-tertiary hover:text-ink-secondary")}>{label}</button>
            ))}
          </div>
          <div className="mb-4 flex items-center gap-2">
            <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email or name…" className="h-8 w-64 pl-8" /></div>
            {search && <button onClick={() => setSearch("")} className="flex items-center gap-1 text-[12px] text-ink-tertiary hover:text-ink-secondary"><X className="h-3.5 w-3.5" /> Clear</button>}
          </div>

          {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
            : q.isLoading ? <SectionLoader rows={6} />
            : items.length === 0 ? <EmptyState icon={Users} title={(q.data ?? []).length ? "No subscribers in this view" : "No subscribers yet"} hint={(q.data ?? []).length ? "Try another filter." : "Add a subscriber (with valid consent) to get started."} />
            : <Card className="overflow-hidden p-0"><div className="divide-y divide-border-subtle">{items.map((s) => <Row key={s.id} s={s} canManage={canManage} />)}</div></Card>}
        </>
      )}

      <NewSubscriberDialog open={newOpen} onOpenChange={setNewOpen} hotelId={currentHotel?.id} />
    </div>
  );
}

function Row({ s, canManage }: { s: Subscriber; canManage: boolean }) {
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-ink-primary">{[s.firstName, s.lastName].filter(Boolean).join(" ") || s.email}</span>
          {s.brevoContactId && <span className="rounded bg-surface-overlay px-1.5 py-0.5 text-[10px] text-ink-tertiary">Brevo synced</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-tertiary">
          <span className="truncate">{s.email}</span>{s.locale && <><span>·</span><span className="uppercase">{s.locale}</span></>}{s.source && <><span>·</span><span>{s.source}</span></>}
        </div>
      </div>
      <ConsentPill state={s.consentState} />
      <SubscriberStatusPill status={s.status} />
    </>
  );
  return canManage
    ? <Link href={`/newsletter/subscribers/${s.id}`} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-overlay/50">{inner}<ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" /></Link>
    : <div className="flex items-center gap-4 px-4 py-3">{inner}</div>;
}

function NewSubscriberDialog({ open, onOpenChange, hotelId }: { open: boolean; onOpenChange: (v: boolean) => void; hotelId?: string }) {
  const create = useCreateSubscriber(hotelId);
  const [email, setEmail] = React.useState("");
  const [first, setFirst] = React.useState("");
  const [last, setLast] = React.useState("");
  const [locale, setLocale] = React.useState("en");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setEmail(""); setFirst(""); setLast(""); setLocale("en"); setError(null); } }, [open]);

  const submit = async () => {
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setError("Enter a valid email."); return; }
    try { await create.mutateAsync({ email: email.trim(), firstName: first.trim() || null, lastName: last.trim() || null, locale, status: "pending" }); onOpenChange(false); }
    catch (e) { setError(humanizeError(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add subscriber</DialogTitle><DialogDescription>Added as pending. Marketing consent must be linked before they can be sent to.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Email</label><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="guest@example.com" autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">First name</label><Input value={first} onChange={(e) => setFirst(e.target.value)} /></div>
            <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Last name</label><Input value={last} onChange={(e) => setLast(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Locale</label>
            <select value={locale} onChange={(e) => setLocale(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">{["en", "hr", "de", "it", "fr", "es"].map((l) => <option key={l} value={l}>{l}</option>)}</select>
          </div>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={submit} loading={create.isPending} disabled={!email.trim()}>Add</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
