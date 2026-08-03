"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Save, History, UploadCloud, Undo2 } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useTemplate, useUpdateTemplate, usePublishTemplate, hasUnpublishedTemplateChanges } from "@/data/newsletter-templates";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, PermissionDenied } from "@/components/content/states";
import { StatusPill } from "@/components/content/pills";
import { BlockEditor } from "@/components/content/block-editor";
import { TextField, TextAreaField } from "@/components/content/fields";
import { EmailPreview } from "@/components/newsletter/email-preview";
import { TemplateHistoryDrawer } from "@/components/newsletter/template-history-drawer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { NewsletterTemplate } from "@/data/newsletter-types";

export default function TemplateEditor() {
  const { templateId } = useParams<{ templateId: string }>();
  const { currentHotel } = useHotel();
  const { role, isPlatformAdmin } = usePermissions();
  const q = useTemplate(templateId);
  const update = useUpdateTemplate(currentHotel?.id);
  const publish = usePublishTemplate(currentHotel?.id);
  const [form, setForm] = React.useState<Partial<NewsletterTemplate>>({});
  const [dirty, setDirty] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  React.useEffect(() => { if (q.data) { setForm(q.data); setDirty(false); } }, [q.data]);

  if (q.isError) return <div className="mx-auto max-w-[1200px] p-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  if (q.isLoading || !q.data) return <div className="mx-auto max-w-[1200px] p-6"><SectionLoader rows={6} /></div>;
  const t = q.data;

  const isCanonical = t.hotelId === null;
  const isHotelOwned = t.hotelId === currentHotel?.id;
  const mayEdit = isPlatformAdmin || (isHotelOwned && (role === "hotel_admin" || role === "marketing"));
  const set = <K extends keyof NewsletterTemplate>(k: K, v: NewsletterTemplate[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); setSaved(false); };
  const pending = hasUnpublishedTemplateChanges({ ...t, ...form } as NewsletterTemplate);

  const save = async () => {
    setSaveError(null);
    try { await update.mutateAsync({ id: templateId, patch: { name: form.name, subject: form.subject, previewText: form.previewText ?? null, content: form.content ?? null } }); setDirty(false); setSaved(true); }
    catch (e) { setSaveError(humanizeError(e)); }
  };
  const revertToLive = () => {
    const s = t.publishedSnapshot; if (!s) return;
    setForm((f) => ({ ...f, name: s.name, subject: s.subject, previewText: s.preview_text ?? null, content: s.content ?? null }));
    setDirty(true); setSaved(false);
  };

  return (
    <div className="mx-auto max-w-[1200px] p-6 pb-24">
      <PageHeader
        crumbs={[{ label: "Newsletter", href: "/newsletter" }, { label: "Templates", href: "/newsletter/templates" }, { label: t.name }]}
        title={<span className="flex items-center gap-3">{form.name || t.name} <StatusPill status={t.status} />{pending && <Badge tone="warning" dot>Unpublished changes</Badge>}</span>}
        subtitle={<span className="flex items-center gap-2">{isCanonical ? <Badge tone="brand">Platform</Badge> : <Badge tone="neutral">Hotel</Badge>} <span className="font-mono text-[12px] text-ink-tertiary">{t.key}</span> · <span className="uppercase text-[12px] text-ink-tertiary">{t.locale}</span></span>}
        backHref="/newsletter/templates"
        actions={<><Button variant="ghost" onClick={() => setHistoryOpen(true)}><History className="h-4 w-4" /> History</Button>{mayEdit && <Button variant="primary" onClick={() => setPublishOpen(true)}><UploadCloud className="h-4 w-4" /> Publish</Button>}</>}
      />

      {!mayEdit && <div className="mb-4"><PermissionDenied message={isCanonical ? "Platform templates are managed by the platform team." : "Your role can view this template but not edit it."} /></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_520px]">
        {/* Left — content */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="space-y-4">
              <TextField label="Name" value={form.name ?? ""} onChange={(v) => set("name", v)} disabled={!mayEdit} />
              <TextField label="Subject" value={form.subject ?? ""} onChange={(v) => set("subject", v)} disabled={!mayEdit} />
              <TextAreaField label="Preview text" value={form.previewText ?? ""} onChange={(v) => set("previewText", v)} disabled={!mayEdit} rows={2} />
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-1 text-[13px] font-semibold text-ink-primary">Content</h2>
            <p className="mb-4 text-[12px] text-ink-tertiary">Structured blocks — no raw HTML.</p>
            <BlockEditor body={form.content ?? null} onChange={(b) => set("content", b)} disabled={!mayEdit} />
          </Card>
        </div>

        {/* Right — email preview + publishing */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card className="p-5">
            <EmailPreview subject={form.subject ?? ""} previewText={form.previewText ?? null} content={form.content ?? null} hotelName={currentHotel?.name ?? "Your Hotel"} />
          </Card>
          <Card className="p-5">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Publishing</div>
            {pending && (
              <div className="mb-3 rounded-md border border-warning/30 bg-warning-soft/40 px-3 py-2 text-[12px] text-warning">
                Saved edits aren’t live yet — new campaigns still snapshot the last published version. Publish to update it.
                {t.publishedSnapshot && mayEdit && <button onClick={revertToLive} className="mt-2 flex items-center gap-1 text-[12px] font-medium text-warning hover:underline"><Undo2 className="h-3.5 w-3.5" /> Revert draft to live</button>}
              </div>
            )}
            <p className="text-[12px] text-ink-tertiary">Published {t.publishedAt ? new Date(t.publishedAt).toLocaleString() : "—"}. Scheduled campaigns keep their own frozen snapshot regardless of edits here.</p>
          </Card>
        </div>
      </div>

      {mayEdit && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border-subtle bg-surface-base/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-3">
            <span className="text-[12px] text-ink-tertiary">{saveError ? <span className="text-danger">{saveError}</span> : dirty ? "Unsaved changes" : saved ? <span className="text-success">Saved</span> : "All changes saved"}</span>
            <Button variant="secondary" onClick={save} loading={update.isPending} disabled={!dirty}><Save className="h-4 w-4" /> Save draft</Button>
          </div>
        </div>
      )}

      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} name={form.name ?? t.name} pending={publish.isPending} onPublish={async (summary) => { await publish.mutateAsync({ id: templateId, changeSummary: summary }); }} />
      <TemplateHistoryDrawer open={historyOpen} onOpenChange={setHistoryOpen} templateId={templateId} hotelId={currentHotel?.id} canRollback={mayEdit} />
    </div>
  );
}

function PublishDialog({ open, onOpenChange, name, onPublish, pending }: { open: boolean; onOpenChange: (v: boolean) => void; name: string; onPublish: (summary: string) => Promise<void>; pending?: boolean }) {
  const [summary, setSummary] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setSummary(""); setError(null); } }, [open]);
  const submit = async () => { setError(null); try { await onPublish(summary.trim()); onOpenChange(false); } catch (e) { setError(humanizeError(e)); } };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Publish “{name}”</DialogTitle><DialogDescription>New campaigns will snapshot this version. Already-scheduled campaigns are unaffected. A version snapshot is saved.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Change summary (optional)</label><textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} placeholder="What changed?" className="w-full resize-y rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none" /></div>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={submit} loading={pending}><UploadCloud className="h-4 w-4" /> Publish</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
