"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useCreateDestArticle, isValidArticleKey } from "@/data/platform-ai-knowledge";
import { usePlatform } from "@/providers/platform-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const slugify = (s: string) => s.toLowerCase().trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const LABEL = "block text-[12px] font-medium text-ink-secondary";

export default function NewArticlePage() {
  const router = useRouter();
  const { currentDestination } = usePlatform();
  const create = useCreateDestArticle();
  const [title, setTitle] = React.useState("");
  const [key, setKey] = React.useState("");
  const [keyTouched, setKeyTouched] = React.useState(false);
  const [approved, setApproved] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const effectiveKey = keyTouched ? key : slugify(title);
  const locale = (currentDestination as any)?.default_locale ?? "en";
  const canSubmit = !!currentDestination && title.trim().length >= 2 && isValidArticleKey(effectiveKey);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!currentDestination) { setErr("Select a destination first."); return; }
    try { const id = await create.mutateAsync({ destination_id: currentDestination.id, key: effectiveKey, title: title.trim(), approved_answer: approved.trim() || null, locale, available_to_ai: true, priority: 0, is_critical: false }); router.push(`/platform/ai-knowledge/${id}`); }
    catch (e: any) { setErr(e?.message ?? "Failed to create article."); }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <Link href="/platform/ai-knowledge" className="inline-flex items-center gap-1.5 text-[13px] text-ink-tertiary hover:text-ink-primary"><ArrowLeft className="h-4 w-4" /> AI Knowledge</Link>
      <header><h1 className="text-xl font-semibold text-ink-primary">New knowledge article</h1><p className="mt-1 text-sm text-ink-tertiary">Creates a <span className="font-medium text-ink-secondary">draft</span> destination-scope answer in <span className="font-medium text-ink-secondary">{currentDestination?.name ?? "…"}</span>.</p></header>
      {!currentDestination ? (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-6 text-center text-sm text-ink-secondary">No destination selected. <Link href="/platform/destinations" className="text-brand-cream underline">Choose one</Link> first.</div>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-border-subtle bg-surface-raised p-5">
          <div className="space-y-1"><label className={LABEL} htmlFor="title">Title / question</label><Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. How do I get from the airport to the old town?" autoFocus /></div>
          <div className="space-y-1"><label className={LABEL} htmlFor="key">Key</label><Input id="key" value={effectiveKey} onChange={(e) => { setKeyTouched(true); setKey(slugify(e.target.value)); }} placeholder="airport-to-old-town" /></div>
          <div className="space-y-1"><label className={LABEL} htmlFor="ans">Approved answer <span className="text-ink-tertiary">(optional now)</span></label><textarea id="ans" value={approved} onChange={(e) => setApproved(e.target.value)} rows={3} className="w-full rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2 text-sm text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2" placeholder="The safe, approved answer the AI may give." /></div>
          {err && <p className="rounded-md bg-danger-soft/50 px-3 py-2 text-[13px] text-danger">{err}</p>}
          <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-4"><Button asChild variant="ghost" size="sm"><Link href="/platform/ai-knowledge">Cancel</Link></Button><Button type="submit" variant="primary" size="sm" disabled={!canSubmit || create.isPending}>{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create draft</Button></div>
        </form>
      )}
    </div>
  );
}
