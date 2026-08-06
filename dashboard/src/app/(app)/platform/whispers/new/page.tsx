"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useCreateWhisper, isValidWhisperKey } from "@/data/platform-whispers";
import { usePlatform } from "@/providers/platform-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const slugify = (s: string) => s.toLowerCase().trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const LABEL = "block text-[12px] font-medium text-ink-secondary";

export default function NewWhisperPage() {
  const router = useRouter();
  const { currentDestination } = usePlatform();
  const create = useCreateWhisper();
  const [title, setTitle] = React.useState("");
  const [channel, setChannel] = React.useState("");
  const [key, setKey] = React.useState("");
  const [keyTouched, setKeyTouched] = React.useState(false);
  const [shortDescription, setShortDescription] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);

  const effectiveKey = keyTouched ? key : slugify(title);
  const channelKey = slugify(channel);
  const canSubmit = !!currentDestination && title.trim().length >= 2 && isValidWhisperKey(effectiveKey) && isValidWhisperKey(channelKey);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!currentDestination) { setErr("Select a destination first."); return; }
    try {
      const id = await create.mutateAsync({ destination_id: currentDestination.id, channel_key: channelKey, key: effectiveKey, title: title.trim(), short_description: shortDescription.trim() || null });
      router.push(`/platform/whispers/${id}`);
    } catch (e: any) { setErr(e?.code === "23505" ? `Key “${effectiveKey}” already exists in this destination.` : (e?.message ?? "Failed to create whisper.")); }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <Link href="/platform/whispers" className="inline-flex items-center gap-1.5 text-[13px] text-ink-tertiary hover:text-ink-primary"><ArrowLeft className="h-4 w-4" /> Whispers</Link>
      <header><h1 className="text-xl font-semibold text-ink-primary">New whisper</h1><p className="mt-1 text-sm text-ink-tertiary">Creates a <span className="font-medium text-ink-secondary">draft</span> in <span className="font-medium text-ink-secondary">{currentDestination?.name ?? "…"}</span>.</p></header>
      {!currentDestination ? (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-6 text-center text-sm text-ink-secondary">No destination selected. <Link href="/platform/destinations" className="text-brand-cream underline">Choose one</Link> first.</div>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-border-subtle bg-surface-raised p-5">
          <div className="space-y-1"><label className={LABEL} htmlFor="title">Title</label><Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Soldier Who Became Emperor" autoFocus /></div>
          <div className="space-y-1"><label className={LABEL} htmlFor="channel">Channel</label><Input id="channel" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="e.g. whispers-of-the-palace" /><p className="text-[11px] text-ink-tertiary">Story channel this chapter belongs to (lowercase-hyphenated).</p></div>
          <div className="space-y-1"><label className={LABEL} htmlFor="key">Key</label><Input id="key" value={effectiveKey} onChange={(e) => { setKeyTouched(true); setKey(slugify(e.target.value)); }} placeholder="ch01" /><p className="text-[11px] text-ink-tertiary">Unique within this destination.</p></div>
          <div className="space-y-1"><label className={LABEL} htmlFor="desc">Short description <span className="text-ink-tertiary">(optional)</span></label><textarea id="desc" value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} rows={2} className="w-full rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2 text-sm text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2" /></div>
          {err && <p className="rounded-md bg-danger-soft/50 px-3 py-2 text-[13px] text-danger">{err}</p>}
          <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-4"><Button asChild variant="ghost" size="sm"><Link href="/platform/whispers">Cancel</Link></Button><Button type="submit" variant="primary" size="sm" disabled={!canSubmit || create.isPending}>{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create draft</Button></div>
        </form>
      )}
    </div>
  );
}
