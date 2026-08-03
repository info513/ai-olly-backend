"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { History, RotateCcw, X } from "lucide-react";
import { DialogOverlay } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { StatusPill } from "@/components/content/pills";
import { useTemplateVersions, useRollbackTemplate } from "@/data/newsletter-templates";
import { humanizeError } from "@/data/errors";
import { relativeTime, cn } from "@/lib/utils";
import type { TemplateVersion } from "@/data/newsletter-types";

/** History + rollback for a newsletter template. Restoring creates a new DRAFT;
 *  the live (published) snapshot and any scheduled campaigns are untouched. */
export function TemplateHistoryDrawer({ open, onOpenChange, templateId, hotelId, canRollback }: { open: boolean; onOpenChange: (v: boolean) => void; templateId: string; hotelId?: string; canRollback: boolean }) {
  const versionsQ = useTemplateVersions(open ? templateId : undefined);
  const rollback = useRollbackTemplate(hotelId);
  const [selected, setSelected] = React.useState<TemplateVersion | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (!open) { setSelected(null); setError(null); } }, [open]);

  const doRollback = async (v: TemplateVersion) => { setError(null); try { await rollback.mutateAsync({ id: templateId, versionId: v.id }); onOpenChange(false); } catch (e) { setError(humanizeError(e)); } };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border-strong bg-surface-overlay shadow-e3 data-[state=open]:animate-in data-[state=open]:slide-in-from-right">
          <VisuallyHidden><DialogPrimitive.Title>Template history</DialogPrimitive.Title></VisuallyHidden>
          <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3.5"><span className="flex items-center gap-2 text-[14px] font-semibold text-ink-primary"><History className="h-4 w-4" /> Version history</span><DialogPrimitive.Close className="rounded-md p-1 text-ink-tertiary hover:text-ink-primary"><X className="h-4 w-4" /></DialogPrimitive.Close></div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <p className="mb-3 rounded-md bg-surface-base px-3 py-2 text-[12px] text-ink-tertiary">Restoring a version creates a <span className="text-ink-secondary">new draft</span>. The live template and already-scheduled campaigns keep their frozen content.</p>
            {versionsQ.isError ? <ErrorState error={versionsQ.error} onRetry={() => versionsQ.refetch()} />
              : versionsQ.isLoading ? <SectionLoader rows={3} />
              : (versionsQ.data ?? []).length === 0 ? <EmptyState icon={History} title="No versions yet" hint="Publishing records the first version." />
              : <div className="space-y-2">{versionsQ.data!.map((v) => (
                <div key={v.id} className={cn("rounded-lg border p-3 transition-colors", selected?.id === v.id ? "border-brand-goldDeep/50 bg-surface-base" : "border-border-subtle hover:border-border-strong")}>
                  <button className="w-full text-left" onClick={() => setSelected(selected?.id === v.id ? null : v)}>
                    <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-[13px] font-medium text-ink-primary">v{v.versionNumber} <StatusPill status={v.status} /></span><span className="text-[11px] text-ink-tertiary">{relativeTime(v.publishedAt ?? v.createdAt)}</span></div>
                    {v.changeSummary && <p className="mt-1 text-[12px] text-ink-secondary">{v.changeSummary}</p>}
                  </button>
                  {selected?.id === v.id && (
                    <div className="mt-3 border-t border-border-subtle pt-3">
                      <div className="space-y-1 text-[12px]"><Row label="Subject" value={v.snapshot?.subject} /><Row label="Preview" value={v.snapshot?.preview_text} /></div>
                      {canRollback && <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => doRollback(v)} loading={rollback.isPending}><RotateCcw className="h-4 w-4" /> Restore as new draft</Button>}
                    </div>
                  )}
                </div>
              ))}</div>}
            {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-ink-tertiary">{label}</span><span className="truncate text-ink-primary">{value ?? "—"}</span></div>;
}
