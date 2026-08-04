"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Save, History, UploadCloud, Eye } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useService, useUpdateService, usePublishService, useCategories, hasUnpublishedChanges } from "@/data/services";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, PermissionDenied } from "@/components/content/states";
import { StatusPill, SourceBadge, VisibilityChips, CriticalBadge } from "@/components/content/pills";
import { BlockEditor } from "@/components/content/block-editor-lazy";
import { BlockView } from "@/components/content/block-view";
import { PublishSheet } from "@/components/content/publish-sheet";
import { HistoryDrawer } from "@/components/content/history-drawer";
import { TextField, TextAreaField, ToggleField, NumberField, Field } from "@/components/content/fields";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { HotelService } from "@/data/types";

const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const fromDateInput = (v: string) => (v ? new Date(v + "T00:00:00Z").toISOString() : null);

export default function ServiceEditor() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const { currentHotel } = useHotel();
  const { role, isPlatformAdmin } = usePermissions();
  const serviceQ = useService(serviceId);
  const categoriesQ = useCategories(currentHotel?.id);
  const update = useUpdateService(currentHotel?.id);
  const publish = usePublishService(currentHotel?.id);

  const [form, setForm] = React.useState<Partial<HotelService>>({});
  const [dirty, setDirty] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  React.useEffect(() => { if (serviceQ.data) { setForm(serviceQ.data); setDirty(false); } }, [serviceQ.data]);

  const s = serviceQ.data;
  const isHotelOwned = !!s && s.hotel_id === currentHotel?.id;
  const mayEdit = isPlatformAdmin || (isHotelOwned && (role === "hotel_admin" || role === "editor"));
  const mayPublish = mayEdit;
  const mayToggleCritical = isPlatformAdmin || (isHotelOwned && role === "hotel_admin");

  const set = <K extends keyof HotelService>(k: K, v: HotelService[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); setSaved(false); };

  const save = async () => {
    setSaveError(null);
    const patch: Partial<HotelService> = {
      title: form.title, short_description: form.short_description ?? null, body_content: form.body_content ?? null,
      category_id: form.category_id, visible_in_pwa: form.visible_in_pwa, visible_in_web: form.visible_in_web,
      available_to_ai: form.available_to_ai, active: form.active, sort_order: form.sort_order,
      valid_from: form.valid_from ?? null, valid_to: form.valid_to ?? null,
    };
    if (mayToggleCritical) patch.is_critical = form.is_critical;
    try { await update.mutateAsync({ id: serviceId, patch }); setDirty(false); setSaved(true); }
    catch (e) { setSaveError(humanizeError(e)); }
  };

  if (serviceQ.isError) return <div className="mx-auto max-w-[1200px] p-6"><ErrorState error={serviceQ.error} onRetry={() => serviceQ.refetch()} /></div>;
  if (serviceQ.isLoading || !s) return <div className="mx-auto max-w-[1200px] p-6"><SectionLoader rows={6} /></div>;

  const dis = !mayEdit;
  const pending = hasUnpublishedChanges(s);   // saved edits not yet live

  return (
    <div className="mx-auto max-w-[1200px] p-6 pb-24">
      <PageHeader
        crumbs={[{ label: "Content", href: "/content" }, { label: "Services", href: "/content/services" }, { label: s.title }]}
        title={<span className="flex items-center gap-3">{form.title || s.title} <StatusPill status={s.status} />{pending && <Badge tone="warning" dot>Unpublished changes</Badge>}</span>}
        subtitle={<span className="flex items-center gap-2"><SourceBadge source={s.source_type} /> {s.categoryName ?? ""}</span>}
        backHref="/content/services"
        actions={
          <>
            <Button variant="ghost" onClick={() => setHistoryOpen(true)}><History className="h-4 w-4" /> History</Button>
            {mayPublish && <Button variant="primary" onClick={() => setPublishOpen(true)}><UploadCloud className="h-4 w-4" /> Publish</Button>}
          </>
        }
      />

      {dis && (
        <div className="mb-4">
          <PermissionDenied message={s.hotel_id === null ? "This is a platform default — only the platform team can edit it. You can preview and (if it applies) override it." : "Your role can view this service but not edit it."} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        {/* Left — editable content */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="space-y-4">
              <TextField label="Title" value={form.title ?? ""} onChange={(v) => set("title", v)} disabled={dis} />
              <TextAreaField label="Short description" value={form.short_description ?? ""} onChange={(v) => set("short_description", v)} disabled={dis} rows={2} />
              <Field label="Category">
                <select value={form.category_id ?? ""} disabled={dis} onChange={(e) => set("category_id", e.target.value)}
                  className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none disabled:opacity-50">
                  {(categoriesQ.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.hotel_id ? "" : " (platform)"}</option>)}
                </select>
              </Field>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 text-[13px] font-semibold text-ink-primary">Content</h2>
            <p className="mb-4 text-[12px] text-ink-tertiary">Structured blocks — no raw HTML.</p>
            <BlockEditor body={form.body_content ?? null} onChange={(b) => set("body_content", b)} disabled={dis} />
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-[13px] font-semibold text-ink-primary">Visibility & rules</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <ToggleField label="Guest app (PWA)" checked={!!form.visible_in_pwa} onChange={(v) => set("visible_in_pwa", v)} disabled={dis} />
              <ToggleField label="Website" checked={!!form.visible_in_web} onChange={(v) => set("visible_in_web", v)} disabled={dis} />
              <ToggleField label="Available to AI" checked={!!form.available_to_ai} onChange={(v) => set("available_to_ai", v)} disabled={dis} />
              <ToggleField label="Active" checked={!!form.active} onChange={(v) => set("active", v)} disabled={dis} />
              <ToggleField label="Critical content" description={mayToggleCritical ? "Requires acknowledgement to publish." : "Only a hotel admin can change this."} checked={!!form.is_critical} onChange={(v) => set("is_critical", v)} disabled={dis || !mayToggleCritical} />
              <NumberField label="Sort order" value={form.sort_order ?? 0} onChange={(v) => set("sort_order", v ?? 0)} disabled={dis} />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Valid from" hint="empty = always">
                <Input type="date" value={toDateInput(form.valid_from ?? null)} disabled={dis} onChange={(e) => set("valid_from", fromDateInput(e.target.value))} />
              </Field>
              <Field label="Valid to" hint="empty = no end">
                <Input type="date" value={toDateInput(form.valid_to ?? null)} disabled={dis} onChange={(e) => set("valid_to", fromDateInput(e.target.value))} />
              </Field>
            </div>
          </Card>
        </div>

        {/* Right — preview + summary */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary"><Eye className="h-4 w-4" /> Guest preview</div>
            <div className="rounded-lg border border-border-subtle bg-surface-sunken p-4">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-display text-[17px] text-ink-primary">{form.title || "Untitled"}</span>
                {form.is_critical && <CriticalBadge />}
              </div>
              {form.short_description && <p className="mb-3 text-[13px] text-ink-secondary">{form.short_description}</p>}
              <BlockView body={form.body_content ?? null} />
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Publishing</div>
            {pending && (
              <p className="mb-3 rounded-md border border-warning/30 bg-warning-soft/40 px-3 py-2 text-[12px] text-warning">
                Saved edits aren’t live yet — guests still see the last published version. Publish to update them.
              </p>
            )}
            {s.status === "draft" && s.published_snapshot && (
              <p className="mb-3 rounded-md border border-info/30 bg-info-soft/40 px-3 py-2 text-[12px] text-info">
                This is a working draft (e.g. after a rollback). Guests still see the last published version until you publish.
              </p>
            )}
            <dl className="space-y-2.5 text-[13px]">
              <SummaryRow label="Status"><StatusPill status={s.status} /></SummaryRow>
              <SummaryRow label="Visible to"><VisibilityChips pwa={!!form.visible_in_pwa} web={!!form.visible_in_web} ai={!!form.available_to_ai} /></SummaryRow>
              <SummaryRow label="Published">{s.published_at ? new Date(s.published_at).toLocaleString() : "—"}</SummaryRow>
              <SummaryRow label="Source"><SourceBadge source={s.source_type} /></SummaryRow>
            </dl>
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

      <PublishSheet
        open={publishOpen}
        onOpenChange={setPublishOpen}
        service={{ ...s, ...form } as HotelService}
        pending={publish.isPending}
        onPublish={async (summary, ack) => { await publish.mutateAsync({ id: serviceId, changeSummary: summary, acknowledgeCritical: ack }); }}
      />
      <HistoryDrawer open={historyOpen} onOpenChange={setHistoryOpen} serviceId={serviceId} hotelId={currentHotel?.id} canRollback={mayEdit} />
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-tertiary">{label}</dt>
      <dd className="text-ink-primary">{children}</dd>
    </div>
  );
}
