"use client";

import * as React from "react";
import { Plus, FileText, UploadCloud, Save, GitBranch, RotateCcw, Lock } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useConsentTemplates, useCreateTemplate, useCreateTemplateVersion, useUpdateTemplate, usePublishTemplate } from "@/data/consents";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState, PermissionDenied } from "@/components/content/states";
import { StatusPill } from "@/components/content/pills";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { relativeTime } from "@/lib/utils";
import type { ConsentTemplate } from "@/data/reception-types";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export default function ConsentTemplates() {
  const { currentHotel } = useHotel();
  const { role, isPlatformAdmin } = usePermissions();
  const q = useConsentTemplates(currentHotel?.id);
  const [newOpen, setNewOpen] = React.useState(false);

  const canManageHotel = isPlatformAdmin || role === "hotel_admin";

  // group by hotel:key:locale
  const groups = React.useMemo(() => {
    const m = new Map<string, ConsentTemplate[]>();
    for (const t of q.data ?? []) {
      const k = `${t.hotelId ?? "platform"}:${t.key}:${t.locale}`;
      (m.get(k) ?? m.set(k, []).get(k)!).push(t);
    }
    return [...m.values()].map((vs) => vs.sort((a, b) => b.version - a.version));
  }, [q.data]);

  return (
    <div className="mx-auto max-w-[1000px] p-6">
      <PageHeader
        crumbs={[{ label: "Consent", href: "/consent" }, { label: "Templates" }]}
        title="Consent templates"
        subtitle="Versioned consent wording. Editing a published version is frozen — changes create a new draft version. Only published versions can be signed."
        actions={canManageHotel && <Button variant="primary" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> New template</Button>}
      />

      <div className="mb-4 rounded-md border border-border-subtle bg-surface-base px-3 py-2 text-[12px] text-ink-tertiary">
        The Dashboard never writes legal wording — enter your hotel's approved text. In this dev environment only synthetic text is used. Already-signed consents keep an immutable snapshot and are never affected by template edits.
      </div>

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <SectionLoader rows={4} />
        : groups.length === 0 ? <EmptyState icon={FileText} title="No templates yet" hint="Create a consent template — e.g. data processing consent." action={canManageHotel && <Button variant="primary" onClick={() => setNewOpen(true)}>New template</Button>} />
        : <div className="space-y-4">{groups.map((versions) => <TemplateGroup key={versions[0].id} versions={versions} hotelId={currentHotel?.id} canManage={isPlatformAdmin || (versions[0].hotelId === currentHotel?.id && role === "hotel_admin")} isPlatform={versions[0].hotelId === null} />)}</div>}

      <NewTemplateDialog open={newOpen} onOpenChange={setNewOpen} hotelId={currentHotel?.id} slug={slug} />
    </div>
  );
}

function TemplateGroup({ versions, hotelId, canManage, isPlatform }: { versions: ConsentTemplate[]; hotelId?: string; canManage: boolean; isPlatform: boolean }) {
  const createVersion = useCreateTemplateVersion(hotelId);
  const update = useUpdateTemplate(hotelId);
  const publish = usePublishTemplate(hotelId);
  const [err, setErr] = React.useState<string | null>(null);

  const draft = versions.find((v) => v.status === "draft");
  const published = versions.find((v) => v.status === "published");
  const head = versions[0];
  const [title, setTitle] = React.useState(draft?.title ?? "");
  const [body, setBody] = React.useState(draft?.bodyText ?? "");
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => { if (draft) { setTitle(draft.title); setBody(draft.bodyText); setDirty(false); } }, [draft?.id]);

  const run = async (p: Promise<unknown>) => { setErr(null); try { await p; } catch (e) { setErr(humanizeError(e)); } };

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><span className="font-medium text-ink-primary">{head.title}</span><Badge tone={isPlatform ? "brand" : "neutral"}>{isPlatform ? "Platform" : "Hotel"}</Badge></div>
          <div className="mt-0.5 font-mono text-[11px] text-ink-tertiary">{head.key} · {head.locale} · {versions.length} version{versions.length > 1 ? "s" : ""}</div>
        </div>
        {published && <Badge tone="success" className="gap-1">Signable · v{published.version}</Badge>}
      </div>

      {err && <p className="mb-3 text-[12px] text-danger">{err}</p>}

      {/* Draft editor */}
      {draft && canManage ? (
        <div className="rounded-md border border-warning/30 bg-warning-soft/20 p-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-warning"><GitBranch className="h-3.5 w-3.5" /> Draft v{draft.version} — not signable until published</div>
          <div className="space-y-2">
            <Input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} placeholder="Title" />
            <textarea value={body} onChange={(e) => { setBody(e.target.value); setDirty(true); }} rows={5} placeholder="Approved consent wording (synthetic in dev)…" className="w-full resize-y rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none" />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="secondary" size="sm" disabled={!dirty} loading={update.isPending} onClick={() => run(update.mutateAsync({ id: draft.id, patch: { title, bodyText: body } }).then(() => setDirty(false)))}><Save className="h-4 w-4" /> Save draft</Button>
            <Button variant="primary" size="sm" loading={publish.isPending} onClick={() => run(publish.mutateAsync({ id: draft.id, changeSummary: `Publish v${draft.version}` }))}><UploadCloud className="h-4 w-4" /> Publish v{draft.version}</Button>
          </div>
        </div>
      ) : published ? (
        <div className="rounded-md border border-border-subtle bg-surface-sunken p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary"><Lock className="h-3.5 w-3.5" /> Published v{published.version} (frozen)</div>
          <p className="whitespace-pre-wrap text-[13px] text-ink-secondary">{published.bodyText}</p>
          {canManage && <div className="mt-3"><Button variant="secondary" size="sm" loading={createVersion.isPending} onClick={() => run(createVersion.mutateAsync(published))}><GitBranch className="h-4 w-4" /> Edit as new version</Button></div>}
        </div>
      ) : null}

      {/* Version history */}
      {versions.length > 1 && (
        <div className="mt-3 border-t border-border-subtle pt-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">History</div>
          <div className="space-y-1.5">
            {versions.map((v) => (
              <div key={v.id} className="flex items-center gap-2 text-[12px]">
                <span className="font-mono text-ink-tertiary">v{v.version}</span>
                <StatusPill status={v.status} />
                <span className="min-w-0 flex-1 truncate text-ink-secondary">{v.title}</span>
                <span className="text-[11px] text-ink-tertiary">{v.publishedAt ? relativeTime(v.publishedAt) : relativeTime(v.updatedAt)}</span>
                {canManage && v.status === "published" && !draft && (
                  <button onClick={() => run(createVersion.mutateAsync(v))} className="flex items-center gap-1 text-[11px] text-ink-tertiary hover:text-brand-cream" title="Restore this wording as a new draft"><RotateCcw className="h-3 w-3" /> Restore</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!canManage && <div className="mt-3"><PermissionDenied message={isPlatform ? "Platform templates are managed by the platform team. You can use published versions to capture consent." : "Your role can view templates but not edit them."} /></div>}
    </Card>
  );
}

function NewTemplateDialog({ open, onOpenChange, hotelId, slug }: { open: boolean; onOpenChange: (v: boolean) => void; hotelId?: string; slug: (s: string) => string }) {
  const create = useCreateTemplate(hotelId);
  const [title, setTitle] = React.useState("");
  const [key, setKey] = React.useState("");
  const [keyEdited, setKeyEdited] = React.useState(false);
  const [locale, setLocale] = React.useState("en");
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setTitle(""); setKey(""); setKeyEdited(false); setLocale("en"); setBody(""); setError(null); } }, [open]);
  React.useEffect(() => { if (!keyEdited) setKey(slug(title)); }, [title, keyEdited]);

  const submit = async () => {
    setError(null);
    if (!title.trim() || !body.trim()) { setError("Title and consent text are required."); return; }
    try { await create.mutateAsync({ key: slug(key || title), locale, title: title.trim(), bodyText: body.trim() }); onOpenChange(false); }
    catch (e) { setError(humanizeError(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New consent template</DialogTitle><DialogDescription>Starts as a draft v1. Publish it to make it signable. Enter your hotel's approved wording (synthetic here).</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Title</label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Data processing consent" autoFocus /></div>
            <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Locale</label><select value={locale} onChange={(e) => setLocale(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">{["en", "hr", "de", "it", "fr", "es"].map((l) => <option key={l} value={l}>{l}</option>)}</select></div>
          </div>
          <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Key</label><Input value={key} onChange={(e) => { setKey(e.target.value); setKeyEdited(true); }} placeholder="data-processing" className="font-mono" /></div>
          <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Consent text</label><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="I agree that…" className="w-full resize-y rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none" /></div>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={submit} loading={create.isPending}>Create draft</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
