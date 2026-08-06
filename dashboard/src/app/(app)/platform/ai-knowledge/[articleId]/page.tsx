"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Loader2, Save, UploadCloud, History, Archive, ArchiveRestore, Eye,
  Brain, ScrollText, MessageSquareText, Tag, ShieldAlert, Sparkles, AlertTriangle, CheckCircle2, RotateCcw, Plus, X,
} from "lucide-react";
import {
  useDestArticle, useUpdateDestArticle, usePublishDestArticle, useRollbackDestArticle, useDestArticleVersions, useSetDestArticleArchived,
  useKCategories, useDestAliases, useAddDestAlias, useDeleteDestAlias, hasUnpublishedArticleChanges, isValidArticleKey,
  type DestArticle,
} from "@/data/platform-ai-knowledge";
import { usePlatform } from "@/providers/platform-provider";
import { StatusBadge } from "@/components/platform/destination-status-badge";
import { BlockEditor } from "@/components/content/block-editor-lazy";
import { BlockView } from "@/components/content/block-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import type { BlockBody } from "@/data/types";

const LABEL = "block text-[12px] font-medium text-ink-secondary";
const SELECT_CLS = "w-full appearance-none rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2 text-sm text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2";
const TA_CLS = "w-full rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2 text-sm text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2";
const d10 = (s: string | null) => (s ? s.slice(0, 10) : "");

type Form = { key: string; title: string; approved_answer: string; category_id: string; priority: string; is_critical: boolean; available_to_ai: boolean; valid_from: string; valid_to: string; };
function toForm(a: DestArticle): Form {
  return { key: a.key ?? "", title: a.title ?? "", approved_answer: a.approved_answer ?? "", category_id: a.category_id ?? "", priority: a.priority?.toString() ?? "0", is_critical: a.is_critical, available_to_ai: a.available_to_ai, valid_from: d10(a.valid_from), valid_to: d10(a.valid_to) };
}

export default function ArticleEditorPage() {
  const params = useParams();
  const id = Array.isArray(params.articleId) ? params.articleId[0] : (params.articleId as string);
  const { setDestination, currentDestination } = usePlatform();
  const { data: art, isLoading, isError, error } = useDestArticle(id);
  const { data: cats = [] } = useKCategories();
  const update = useUpdateDestArticle(); const publish = usePublishDestArticle(); const archive = useSetDestArticleArchived();
  const [form, setForm] = React.useState<Form | null>(null);
  const [body, setBody] = React.useState<BlockBody | null>(null);
  const [changeSummary, setChangeSummary] = React.useState("");
  const [ack, setAck] = React.useState(false);
  const [preview, setPreview] = React.useState<"draft" | "live">("draft");
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);

  React.useEffect(() => { if (art) { setForm(toForm(art)); setBody(art.body_content ?? null); } }, [art?.id, art?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (art?.destination_id) setDestination(art.destination_id); }, [art?.destination_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  if (isError) return <ErrorState message={(error as any)?.message} />;
  if (isLoading || !art || !form) return <LoadingState />;

  const keyValid = isValidArticleKey(form.key);
  const canSave = form.title.trim().length >= 2 && keyValid;
  const priorityNum = Number.isNaN(Number(form.priority)) ? 0 : Math.round(Number(form.priority));

  const patch = () => ({
    key: form.key.trim(), title: form.title.trim(), approved_answer: form.approved_answer.trim() || null,
    body_content: body && (body.blocks?.length ?? 0) > 0 ? body : null,
    category_id: form.category_id || null, priority: priorityNum, is_critical: form.is_critical, available_to_ai: form.available_to_ai,
    valid_from: form.valid_from ? new Date(form.valid_from).toISOString() : null,
    valid_to: form.valid_to ? new Date(form.valid_to).toISOString() : null,
  });

  const saveDraft = async () => { setMsg(null); try { await update.mutateAsync({ id, patch: patch() }); setMsg({ tone: "ok", text: "Draft saved." }); } catch (e: any) { setMsg({ tone: "err", text: e?.message ?? "Save failed." }); } };
  const doPublish = async () => {
    setMsg(null);
    if (form.is_critical && !ack) { setMsg({ tone: "err", text: "This is critical content — tick the acknowledgement to publish." }); return; }
    try { if (canSave) await update.mutateAsync({ id, patch: patch() }); await publish.mutateAsync({ id, changeSummary: changeSummary.trim() || undefined, acknowledgeCritical: form.is_critical ? ack : false }); setChangeSummary(""); setAck(false); setMsg({ tone: "ok", text: "Published — live for all hotels in this destination." }); }
    catch (e: any) { setMsg({ tone: "err", text: e?.message ?? "Publish failed." }); }
  };
  const toggleArchive = async () => { setMsg(null); const archived = art!.status !== "archived"; try { await archive.mutateAsync({ id, archived }); setMsg({ tone: "ok", text: archived ? "Article archived." : "Article restored to draft." }); } catch (e: any) { setMsg({ tone: "err", text: e?.message ?? "Action failed." }); } };

  const unpublished = hasUnpublishedArticleChanges(art) || JSON.stringify(body ?? null) !== JSON.stringify((art.published_snapshot as any)?.body_content ?? art.body_content ?? null);
  const live = (art.published_snapshot ?? null) as any;
  const busy = update.isPending || publish.isPending || archive.isPending;

  const warnings: string[] = [];
  if (art.status === "draft") warnings.push("Not yet published — the AI can’t use this article.");
  if (!form.approved_answer.trim() && (!body || (body.blocks?.length ?? 0) === 0)) warnings.push("No approved answer or body — the AI has nothing to say.");
  if (!form.available_to_ai) warnings.push("Hidden from AI — this won’t be used for answers.");
  if (form.is_critical && !ack && art.status !== "published") warnings.push("Critical content requires acknowledgement to publish.");
  if (unpublished) warnings.push("Draft has unpublished changes.");

  const src = preview === "live" && live ? live : patch();
  const previewBody = preview === "live" ? ((live?.body_content ?? null) as BlockBody | null) : body;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href="/platform/ai-knowledge" className="inline-flex items-center gap-1.5 text-[13px] text-ink-tertiary hover:text-ink-primary"><ArrowLeft className="h-4 w-4" /> AI Knowledge · {currentDestination?.name ?? "…"}</Link>
          <div className="mt-1 flex flex-wrap items-center gap-2"><h1 className="truncate text-xl font-semibold text-ink-primary">{form.title || "Untitled"}</h1><StatusBadge status={art.status} />{art.is_critical && <Badge tone="danger" dot>Critical</Badge>}{art.available_to_ai ? <Badge tone="success"><Sparkles className="h-3 w-3" /> AI</Badge> : <Badge tone="neutral">Hidden</Badge>}{unpublished && <span className="rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">unpublished changes</span>}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HistoryDialog id={id} />
          <Button variant="ghost" size="sm" onClick={toggleArchive} disabled={busy}>{art.status === "archived" ? <><ArchiveRestore className="h-4 w-4" /> Restore</> : <><Archive className="h-4 w-4" /> Archive</>}</Button>
          <Button variant="secondary" size="sm" onClick={saveDraft} disabled={!canSave || busy}>{update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft</Button>
        </div>
      </div>
      {msg && <p className={`rounded-md px-3 py-2 text-[13px] ${msg.tone === "ok" ? "bg-success-soft/50 text-success" : "bg-danger-soft/50 text-danger"}`}>{msg.text}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Section icon={Brain} title="Identity">
            <Grid>
              <Field label="Title / question"><Input value={form.title} onChange={(e) => set("title", e.target.value)} /></Field>
              <Field label="Key" hint={keyValid ? undefined : "lowercase-hyphenated"}><Input value={form.key} onChange={(e) => set("key", e.target.value)} aria-invalid={!keyValid} /></Field>
              <Field label="Category">
                <select className={SELECT_CLS} value={form.category_id} onChange={(e) => set("category_id", e.target.value)}><option value="">— None —</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              </Field>
              <Field label="Priority"><Input value={form.priority} onChange={(e) => set("priority", e.target.value)} inputMode="numeric" /></Field>
            </Grid>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-[13px] text-ink-secondary"><input type="checkbox" checked={form.available_to_ai} onChange={(e) => set("available_to_ai", e.target.checked)} className="h-4 w-4 rounded border-border-strong" /> Available to AI</label>
              <label className="flex items-center gap-2 text-[13px] text-ink-secondary"><input type="checkbox" checked={form.is_critical} onChange={(e) => set("is_critical", e.target.checked)} className="h-4 w-4 rounded border-border-strong" /> <ShieldAlert className="h-3.5 w-3.5 text-danger" /> Critical (safety/emergency)</label>
            </div>
          </Section>
          <Section icon={MessageSquareText} title="Approved answer">
            <textarea className={TA_CLS} rows={4} value={form.approved_answer} onChange={(e) => set("approved_answer", e.target.value)} placeholder="The safe answer the AI may give verbatim." />
            <p className="text-[11px] text-ink-tertiary">The AI answers only from approved content; unknown → safe handoff, never invention.</p>
          </Section>
          <Section icon={ScrollText} title="Body (optional structured content)"><BlockEditor body={body} onChange={setBody} /></Section>
          <Section icon={Tag} title="Aliases (phrase → this article)"><AliasesPanel articleId={id} locale={art.locale} /></Section>
          <Section icon={AlertTriangle} title="Validity">
            <Grid>
              <Field label="Valid from"><Input type="date" value={form.valid_from} onChange={(e) => set("valid_from", e.target.value)} /></Field>
              <Field label="Valid to"><Input type="date" value={form.valid_to} onChange={(e) => set("valid_to", e.target.value)} /></Field>
            </Grid>
          </Section>
        </div>

        <div className="space-y-4">
          <Section icon={Eye} title="Preview" action={<div className="flex overflow-hidden rounded-md border border-border-subtle text-[11px]"><button onClick={() => setPreview("draft")} className={`px-2 py-1 ${preview === "draft" ? "bg-brand-navy/60 text-ink-primary" : "text-ink-tertiary"}`}>Draft</button><button onClick={() => setPreview("live")} disabled={!live} className={`px-2 py-1 ${preview === "live" ? "bg-brand-navy/60 text-ink-primary" : "text-ink-tertiary"} disabled:opacity-40`}>Live</button></div>}>
            {preview === "live" && !live ? <p className="text-[12px] text-ink-tertiary">No live version yet — publish to create one.</p> : (
              <div className="rounded-lg border border-border-subtle bg-surface-sunken p-3">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-tertiary">{preview === "live" ? "Live (published)" : "Draft"} · AI answer</div>
                <div className="text-[13px] font-medium text-ink-primary">{src.title || "Untitled"}</div>
                {src.approved_answer ? <p className="mt-2 rounded-md bg-brand-navy/30 p-2 text-[13px] text-ink-secondary">{src.approved_answer}</p> : <p className="mt-2 text-[12px] italic text-ink-tertiary">No approved answer.</p>}
                {previewBody && <div className="mt-2"><BlockView body={previewBody} /></div>}
              </div>
            )}
          </Section>
          <Section icon={UploadCloud} title="Publishing">
            <p className="text-[12px] text-ink-tertiary">Publishing makes this answer available to the AI at the destination scope for all hotels.</p>
            {form.is_critical && <label className="flex items-start gap-2 rounded-md bg-danger-soft/30 px-2.5 py-2 text-[12px] text-danger"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border-strong" /> I acknowledge this is critical safety/emergency content and the answer is correct.</label>}
            <textarea className={TA_CLS} rows={2} placeholder="Change summary (optional)" value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} />
            <Button variant="primary" size="sm" className="w-full" onClick={doPublish} disabled={busy || !canSave || (form.is_critical && !ack)}>{publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Publish article</Button>
            {art.published_at && <p className="text-[11px] text-ink-tertiary">Last published {new Date(art.published_at).toLocaleString()}</p>}
          </Section>
          <Section icon={AlertTriangle} title="Warnings">{warnings.length === 0 ? <p className="inline-flex items-center gap-1.5 text-[13px] text-success"><CheckCircle2 className="h-4 w-4" /> No warnings.</p> : <ul className="space-y-1">{warnings.map((w, i) => <li key={i} className="inline-flex items-start gap-1.5 text-[12px] text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}</li>)}</ul>}</Section>
        </div>
      </div>
    </div>
  );
}

function AliasesPanel({ articleId, locale }: { articleId: string; locale: string }) {
  const { data: aliases = [], isLoading } = useDestAliases(articleId);
  const add = useAddDestAlias(); const del = useDeleteDestAlias();
  const [text, setText] = React.useState("");
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an alias phrase guests might type…" onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { e.preventDefault(); add.mutate({ articleId, aliasText: text.trim(), locale }); setText(""); } }} />
        <Button variant="secondary" size="sm" disabled={!text.trim() || add.isPending} onClick={() => { add.mutate({ articleId, aliasText: text.trim(), locale }); setText(""); }}><Plus className="h-4 w-4" /> Add</Button>
      </div>
      {isLoading ? <Skeleton className="h-8 w-full rounded-md" /> : aliases.length === 0 ? <p className="text-[12px] text-ink-tertiary">No aliases yet. Aliases improve AI matching for this article.</p> : (
        <div className="flex flex-wrap gap-1.5">{aliases.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-sunken px-2 py-0.5 text-[12px] text-ink-secondary">{a.alias_text}<button onClick={() => del.mutate({ id: a.id, articleId })} className="text-ink-tertiary hover:text-danger" aria-label={`Remove alias ${a.alias_text}`}><X className="h-3 w-3" /></button></span>
        ))}</div>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, action, children }: { icon: any; title: string; action?: React.ReactNode; children: React.ReactNode }) { return <section className="rounded-xl border border-border-subtle bg-surface-raised p-4"><div className="mb-3 flex items-center justify-between"><h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-primary"><Icon className="h-4 w-4 text-ink-tertiary" /> {title}</h2>{action}</div><div className="space-y-3">{children}</div></section>; }
function Grid({ children }: { children: React.ReactNode }) { return <div className="grid gap-3 sm:grid-cols-2">{children}</div>; }
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <div className="space-y-1"><label className={LABEL}>{label}</label>{children}{hint && <p className="text-[11px] text-warning">{hint}</p>}</div>; }

function HistoryDialog({ id }: { id: string }) {
  const { data: versions = [], isLoading } = useDestArticleVersions(id);
  const rollback = useRollbackDestArticle();
  const [busyV, setBusyV] = React.useState<string | null>(null);
  return (
    <Dialog><DialogTrigger asChild><Button variant="ghost" size="sm"><History className="h-4 w-4" /> History</Button></DialogTrigger>
      <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Version history</DialogTitle><DialogDescription>Published versions. Rolling back restores that snapshot into a new draft (live stays until you re-publish).</DialogDescription></DialogHeader>
        {isLoading ? <div className="space-y-2 py-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)}</div> : versions.length === 0 ? <p className="py-4 text-center text-[13px] text-ink-tertiary">No published versions yet.</p> : (
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto py-1">{versions.map((v) => (
            <li key={v.id} className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface-sunken px-3 py-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-navy/50 text-[12px] font-semibold text-brand-cream">v{v.version_number}</span><div className="min-w-0 flex-1"><div className="truncate text-[13px] text-ink-primary">{v.change_summary || "(no summary)"}</div><div className="text-[11px] text-ink-tertiary">{new Date(v.published_at ?? v.created_at).toLocaleString()}</div></div><Button variant="ghost" size="sm" disabled={busyV === v.id} onClick={async () => { setBusyV(v.id); try { await rollback.mutateAsync({ id, versionId: v.id }); } finally { setBusyV(null); } }}>{busyV === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Roll back</Button></li>
          ))}</ul>
        )}
        <div className="flex justify-end pt-2"><DialogClose asChild><Button variant="secondary" size="sm">Close</Button></DialogClose></div>
      </DialogContent>
    </Dialog>
  );
}
function LoadingState() { return <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6"><Skeleton className="h-6 w-40" /><div className="grid gap-4 lg:grid-cols-[1fr_360px]"><div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}</div><div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}</div></div></div>; }
function ErrorState({ message }: { message?: string }) { return <div className="mx-auto max-w-2xl p-6"><div className="rounded-xl border border-danger/30 bg-danger-soft/40 p-6 text-center"><AlertTriangle className="mx-auto h-6 w-6 text-danger" /><p className="mt-2 text-sm text-ink-secondary">Couldn’t load this article. {message}</p><Button asChild variant="secondary" size="sm" className="mt-3"><Link href="/platform/ai-knowledge">Back to AI Knowledge</Link></Button></div></div>; }
