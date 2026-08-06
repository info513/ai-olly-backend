"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useCreateEvent, isValidEventKey } from "@/data/platform-events";
import { usePlatform } from "@/providers/platform-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const slugify = (s: string) => s.toLowerCase().trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const LABEL = "block text-[12px] font-medium text-ink-secondary";

export default function NewEventPage() {
  const router = useRouter();
  const { currentDestination } = usePlatform();
  const create = useCreateEvent();
  const [title, setTitle] = React.useState("");
  const [key, setKey] = React.useState("");
  const [keyTouched, setKeyTouched] = React.useState(false);
  const [location, setLocation] = React.useState("");
  const [shortDescription, setShortDescription] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const effectiveKey = keyTouched ? key : slugify(title);
  const canSubmit = !!currentDestination && title.trim().length >= 2 && isValidEventKey(effectiveKey);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!currentDestination) { setErr("Select a destination first."); return; }
    try { const id = await create.mutateAsync({ destination_id: currentDestination.id, key: effectiveKey, title: title.trim(), location_name: location.trim() || null, short_description: shortDescription.trim() || null }); router.push(`/platform/events/${id}`); }
    catch (e: any) { setErr(e?.code === "23505" ? `Key “${effectiveKey}” already exists in this destination.` : (e?.message ?? "Failed to create event.")); }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <Link href="/platform/events" className="inline-flex items-center gap-1.5 text-[13px] text-ink-tertiary hover:text-ink-primary"><ArrowLeft className="h-4 w-4" /> Events</Link>
      <header><h1 className="text-xl font-semibold text-ink-primary">New event</h1><p className="mt-1 text-sm text-ink-tertiary">Creates a <span className="font-medium text-ink-secondary">draft</span> in <span className="font-medium text-ink-secondary">{currentDestination?.name ?? "…"}</span>. Add dates and details next.</p></header>
      {!currentDestination ? (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-6 text-center text-sm text-ink-secondary">No destination selected. <Link href="/platform/destinations" className="text-brand-cream underline">Choose one</Link> first.</div>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-border-subtle bg-surface-raised p-5">
          <div className="space-y-1"><label className={LABEL} htmlFor="title">Title</label><Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Summer Music Festival" autoFocus /></div>
          <div className="space-y-1"><label className={LABEL} htmlFor="key">Key</label><Input id="key" value={effectiveKey} onChange={(e) => { setKeyTouched(true); setKey(slugify(e.target.value)); }} placeholder="summer-music-festival" /><p className="text-[11px] text-ink-tertiary">Unique within this destination.</p></div>
          <div className="space-y-1"><label className={LABEL} htmlFor="loc">Location <span className="text-ink-tertiary">(optional)</span></label><Input id="loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Riva promenade" /></div>
          <div className="space-y-1"><label className={LABEL} htmlFor="desc">Short description <span className="text-ink-tertiary">(optional)</span></label><textarea id="desc" value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} rows={2} className="w-full rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2 text-sm text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2" /></div>
          {err && <p className="rounded-md bg-danger-soft/50 px-3 py-2 text-[13px] text-danger">{err}</p>}
          <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-4"><Button asChild variant="ghost" size="sm"><Link href="/platform/events">Cancel</Link></Button><Button type="submit" variant="primary" size="sm" disabled={!canSubmit || create.isPending}>{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create draft</Button></div>
        </form>
      )}
    </div>
  );
}
