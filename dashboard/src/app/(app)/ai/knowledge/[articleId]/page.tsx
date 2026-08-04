"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Save, History, UploadCloud, Eye, Sparkles, Undo2, PlayCircle, Link2 } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import {
  useKnowledgeArticle, useUpdateArticle, usePublishArticle, useKnowledgeCategories, hasUnpublishedArticleChanges,
} from "@/data/knowledge";
import { humanizeError } from "@/data/errors";
import { SCOPE_LABEL } from "@/data/ai-types";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, PermissionDenied } from "@/components/content/states";
import { StatusPill } from "@/components/content/pills";
import { ScopeBadge, CriticalBadge, AiChip } from "@/components/ai/ai-pills";
import { BlockEditor } from "@/components/content/block-editor-lazy";
import { BlockView } from "@/components/content/block-view";
import { KnowledgePublishSheet } from "@/components/ai/knowledge-publish-sheet";
import { KnowledgeHistoryDrawer } from "@/components/ai/knowledge-history-drawer";
import { TextField, TextAreaField, ToggleField, NumberField, Field } from "@/components/content/fields";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { KnowledgeArticle } from "@/data/ai-types";

const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const fromDateInput = (v: string) => (v ? new Date(v + "T00:00:00Z").toISOString() : null);

export default function ArticleEditor() {
  const { articleId } = useParams<{ articleId: string }>();
  const { currentHotel } = useHotel();
  const { role, isPlatformAdmin } = usePermissions();
  const articleQ = useKnowledgeArticle(articleId);
  const categoriesQ = useKnowledgeCategories(currentHotel?.id);
  const update = useUpdateArticle(currentHotel?.id);
  const publish = usePublishArticle(currentHotel?.id);

  const [form, setForm] = React.useState<Partial<KnowledgeArticle>>({});
  const [dirty, setDirty] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  React.useEffect(() => { if (articleQ.data) { setForm(articleQ.data); setDirty(false); } }, [articleQ.data]);

  const a = articleQ.data;
  const isCanonical = !!a && a.hotel_id === null;                    // platform/destination
  const isHotelOwned = !!a && a.hotel_id === currentHotel?.id;
  const mayEdit = isPlatformAdmin || (isHotelOwned && (role === "hotel_admin" || role === "editor"));
  const mayPublish = mayEdit;
  const mayToggleCritical = isPlatformAdmin || (isHotelOwned && role === "hotel_admin");

  const set = <K extends keyof KnowledgeArticle>(k: K, v: KnowledgeArticle[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); setSaved(false); };

  const save = async () => {
    setSaveError(null);
    const patch: Partial<KnowledgeArticle> = {
      title: form.title, approved_answer: form.approved_answer ?? null, body_content: form.body_content ?? null,
      category_id: form.category_id ?? null, available_to_ai: form.available_to_ai, active: form.active,
      priority: form.priority, valid_from: form.valid_from ?? null, valid_to: form.valid_to ?? null,
    };
    if (mayToggleCritical) patch.is_critical = form.is_critical;
    try { await update.mutateAsync({ id: articleId, patch }); setDirty(false); setSaved(true); }
    catch (e) { setSaveError(humanizeError(e)); }
  };

  const revertToLive = () => {
    if (!a?.published_snapshot) return;
    const s = a.published_snapshot;
    setForm((f) => ({
      ...f, title: s.title, approved_answer: s.approved_answer ?? null, body_content: s.body_content ?? null,
      category_id: s.category_id ?? null, available_to_ai: !!s.available_to_ai, active: s.active ?? true,
      priority: s.priority ?? 0, is_critical: !!s.is_critical, valid_from: s.valid_from ?? null, valid_to: s.valid_to ?? null,
    }));
    setDirty(true); setSaved(false);
  };

  if (articleQ.isError) return <div className="mx-auto max-w-[1200px] p-6"><ErrorState error={articleQ.error} onRetry={() => articleQ.refetch()} /></div>;
  if (articleQ.isLoading || !a) return <div className="mx-auto max-w-[1200px] p-6"><SectionLoader rows={6} /></div>;

  const dis = !mayEdit;
  const pending = hasUnpublishedArticleChanges({ ...a, ...form } as KnowledgeArticle);

  return (
    <div className="mx-auto max-w-[1200px] p-6 pb-24">
      <PageHeader
        crumbs={[{ label: "AI", href: "/ai" }, { label: "Knowledge", href: "/ai/knowledge" }, { label: a.title }]}
        title={<span className="flex items-center gap-3">{form.title || a.title} <StatusPill status={a.status} />{pending && <Badge tone="warning" dot>Unpublished changes</Badge>}</span>}
        subtitle={<span className="flex items-center gap-2"><ScopeBadge scope={a.source_type} /> <span className="font-mono text-[12px] text-ink-tertiary">{a.key}</span> · <span className="uppercase text-[12px] text-ink-tertiary">{a.locale}</span></span>}
        backHref="/ai/knowledge"
        actions={
          <>
            <Link href="/ai/preview" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong px-3 text-[13px] font-medium text-ink-secondary hover:text-ink-primary"><PlayCircle className="h-4 w-4" /> Test in Preview</Link>
            <Button variant="ghost" onClick={() => setHistoryOpen(true)}><History className="h-4 w-4" /> History</Button>
            {mayPublish && <Button variant="primary" onClick={() => setPublishOpen(true)}><UploadCloud className="h-4 w-4" /> Publish</Button>}
          </>
        }
      />

      {dis && (
        <div className="mb-4">
          <PermissionDenied message={isCanonical ? "This is a platform/destination default — only the platform team can edit it. Your hotel can create an override with the same key to change what guests here are told." : "Your role can view this article but not edit it."} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        {/* Left — editable content */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="space-y-4">
              <TextField label="Title" value={form.title ?? ""} onChange={(v) => set("title", v)} disabled={dis} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Key" hint="identifier — shared with any override"><Input value={a.key} disabled className="font-mono" /></Field>
                <Field label="Category">
                  <select value={form.category_id ?? ""} disabled={dis} onChange={(e) => set("category_id", e.target.value || null)}
                    className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none disabled:opacity-50">
                    <option value="">Uncategorized</option>
                    {(categoriesQ.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.hotel_id ? "" : " (platform)"}</option>)}
                  </select>
                </Field>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-1 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-cream" />
              <h2 className="text-[13px] font-semibold text-ink-primary">Approved answer</h2>
            </div>
            <p className="mb-3 text-[12px] text-ink-tertiary">The concise, hotel-approved reply the AI uses first. Leave empty to let it summarize the content below.</p>
            <TextAreaField label="" value={form.approved_answer ?? ""} onChange={(v) => set("approved_answer", v || null)} disabled={dis} rows={3} placeholder="Check-in is from 15:00. Early check-in on request." />
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 text-[13px] font-semibold text-ink-primary">Content</h2>
            <p className="mb-4 text-[12px] text-ink-tertiary">Structured blocks — no raw HTML.</p>
            <BlockEditor body={form.body_content ?? null} onChange={(b) => set("body_content", b)} disabled={dis} />
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-[13px] font-semibold text-ink-primary">AI rules & validity</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <ToggleField label="Available to AI" description="Include in retrieval." checked={!!form.available_to_ai} onChange={(v) => set("available_to_ai", v)} disabled={dis} />
              <ToggleField label="Active" checked={!!form.active} onChange={(v) => set("active", v)} disabled={dis} />
              <ToggleField label="Critical content" description={mayToggleCritical ? "Requires acknowledgement to publish." : "Only a hotel admin can change this."} checked={!!form.is_critical} onChange={(v) => set("is_critical", v)} disabled={dis || !mayToggleCritical} />
              <NumberField label="Priority" hint="higher wins ties" value={form.priority ?? 0} onChange={(v) => set("priority", v ?? 0)} disabled={dis} />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Valid from" hint="empty = always"><Input type="date" value={toDateInput(form.valid_from ?? null)} disabled={dis} onChange={(e) => set("valid_from", fromDateInput(e.target.value))} /></Field>
              <Field label="Valid to" hint="empty = no end"><Input type="date" value={toDateInput(form.valid_to ?? null)} disabled={dis} onChange={(e) => set("valid_to", fromDateInput(e.target.value))} /></Field>
            </div>
          </Card>
        </div>

        {/* Right — preview + publishing */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary"><Eye className="h-4 w-4" /> How the AI would answer</div>
            <div className="rounded-lg border border-border-subtle bg-surface-sunken p-4">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-display text-[17px] text-ink-primary">{form.title || "Untitled"}</span>
                {form.is_critical && <CriticalBadge />}
              </div>
              {form.approved_answer ? (
                <div className="mb-3 flex items-start gap-2 rounded-md border border-brand-navySoft/40 bg-brand-navy/20 px-3 py-2 text-[13px] text-brand-creamSoft">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{form.approved_answer}</span>
                </div>
              ) : (
                <p className="mb-3 text-[12px] italic text-ink-tertiary">No approved answer — the AI summarizes the content.</p>
              )}
              <BlockView body={form.body_content ?? null} />
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Publishing</div>
            {pending && (
              <div className="mb-3 rounded-md border border-warning/30 bg-warning-soft/40 px-3 py-2 text-[12px] text-warning">
                Saved edits aren’t live yet — the AI still uses the last published version. Publish to update it.
                {a.published_snapshot && mayEdit && (
                  <button onClick={revertToLive} className="mt-2 flex items-center gap-1 text-[12px] font-medium text-warning hover:underline"><Undo2 className="h-3.5 w-3.5" /> Revert draft to live</button>
                )}
              </div>
            )}
            {a.status === "draft" && a.published_snapshot && (
              <p className="mb-3 rounded-md border border-info/30 bg-info-soft/40 px-3 py-2 text-[12px] text-info">This is a working draft (e.g. after a rollback). The AI keeps using the last published version until you publish.</p>
            )}
            <dl className="space-y-2.5 text-[13px]">
              <Row label="Status"><StatusPill status={a.status} /></Row>
              <Row label="Scope"><ScopeBadge scope={a.source_type} full /></Row>
              <Row label="Available to AI"><AiChip on={!!form.available_to_ai} /></Row>
              <Row label="Published">{a.published_at ? new Date(a.published_at).toLocaleString() : "—"}</Row>
            </dl>
            {a.override_of_article_id && (
              <p className="mt-3 flex items-start gap-2 rounded-md border border-border-subtle bg-surface-base px-3 py-2 text-[12px] text-ink-secondary">
                <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-tertiary" /> This is a <span className="font-medium">hotel-specific override</span> of a platform default with the same key — it wins for guests here.
              </p>
            )}
            {isCanonical && (
              <p className="mt-3 rounded-md border border-brand-navySoft/40 bg-brand-navy/15 px-3 py-2 text-[12px] text-brand-creamSoft">{SCOPE_LABEL[a.source_type]} — shared across hotels. Only the platform team edits it here.</p>
            )}
          </Card>
        </div>
      </div>

      {mayEdit && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border-subtle bg-surface-base/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-3">
            <span className="text-[12px] text-ink-tertiary">
              {saveError ? <span className="text-danger">{saveError}</span> : dirty ? "Unsaved changes" : saved ? <span className="text-success">Saved</span> : "All changes saved"}
            </span>
            <Button variant="secondary" onClick={save} loading={update.isPending} disabled={!dirty}><Save className="h-4 w-4" /> Save draft</Button>
          </div>
        </div>
      )}

      <KnowledgePublishSheet
        open={publishOpen} onOpenChange={setPublishOpen}
        article={{ ...a, ...form } as KnowledgeArticle} pending={publish.isPending}
        onPublish={async (summary, ack) => { await publish.mutateAsync({ id: articleId, changeSummary: summary, acknowledgeCritical: ack }); }}
      />
      <KnowledgeHistoryDrawer open={historyOpen} onOpenChange={setHistoryOpen} articleId={articleId} hotelId={currentHotel?.id} canRollback={mayEdit} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-tertiary">{label}</dt>
      <dd className="text-ink-primary">{children}</dd>
    </div>
  );
}
