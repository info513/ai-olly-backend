"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { History, RotateCcw, X } from "lucide-react";
import { DialogOverlay } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionLoader, ErrorState, EmptyState } from "./states";
import { StatusPill } from "./pills";
import { useServiceVersions, useRollbackService } from "@/data/services";
import { humanizeError } from "@/data/errors";
import { relativeTime, cn } from "@/lib/utils";
import type { ServiceVersion } from "@/data/types";

/** History + rollback (Part 10). Right-side drawer over content_versions. */
export function HistoryDrawer({
  open, onOpenChange, serviceId, hotelId, canRollback,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  serviceId: string;
  hotelId?: string;
  canRollback: boolean;
}) {
  const versionsQ = useServiceVersions(open ? serviceId : undefined);
  const rollback = useRollbackService(hotelId);
  const [selected, setSelected] = React.useState<ServiceVersion | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => { if (!open) { setSelected(null); setError(null); } }, [open]);

  const doRollback = async (v: ServiceVersion) => {
    setError(null);
    try {
      await rollback.mutateAsync({ id: serviceId, versionId: v.id });
      onOpenChange(false);
    } catch (e) { setError(humanizeError(e)); }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border-strong bg-surface-overlay shadow-e3 data-[state=open]:animate-in data-[state=open]:slide-in-from-right">
          <VisuallyHidden><DialogPrimitive.Title>Version history</DialogPrimitive.Title></VisuallyHidden>
          <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3.5">
            <span className="flex items-center gap-2 text-[14px] font-semibold text-ink-primary"><History className="h-4 w-4" /> Version history</span>
            <DialogPrimitive.Close className="rounded-md p-1 text-ink-tertiary hover:text-ink-primary"><X className="h-4 w-4" /></DialogPrimitive.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <p className="mb-3 rounded-md bg-surface-base px-3 py-2 text-[12px] text-ink-tertiary">
              Restoring a version creates a <span className="text-ink-secondary">new draft</span> — historical versions are never overwritten.
            </p>
            {versionsQ.isError ? (
              <ErrorState error={versionsQ.error} onRetry={() => versionsQ.refetch()} />
            ) : versionsQ.isLoading ? (
              <SectionLoader rows={4} />
            ) : (versionsQ.data ?? []).length === 0 ? (
              <EmptyState icon={History} title="No versions yet" hint="Publishing this service will record its first version." />
            ) : (
              <div className="space-y-2">
                {versionsQ.data!.map((v) => (
                  <div key={v.id} className={cn("rounded-lg border p-3 transition-colors", selected?.id === v.id ? "border-brand-goldDeep/50 bg-surface-base" : "border-border-subtle hover:border-border-strong")}>
                    <button className="w-full text-left" onClick={() => setSelected(selected?.id === v.id ? null : v)}>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-[13px] font-medium text-ink-primary">v{v.version_number} <StatusPill status={v.status} /></span>
                        <span className="text-[11px] text-ink-tertiary">{relativeTime(v.published_at ?? v.created_at)}</span>
                      </div>
                      {v.change_summary && <p className="mt-1 text-[12px] text-ink-secondary">{v.change_summary}</p>}
                    </button>

                    {selected?.id === v.id && (
                      <div className="mt-3 border-t border-border-subtle pt-3">
                        <div className="space-y-1 text-[12px]">
                          <SnapRow label="Title" value={v.snapshot?.title} />
                          <SnapRow label="Status" value={v.snapshot?.status} />
                          <SnapRow label="Critical" value={v.snapshot?.is_critical ? "Yes" : "No"} />
                          <SnapRow label="PWA / Web / AI" value={`${v.snapshot?.visible_in_pwa ? "Y" : "N"} / ${v.snapshot?.visible_in_web ? "Y" : "N"} / ${v.snapshot?.available_to_ai ? "Y" : "N"}`} />
                        </div>
                        {canRollback && (
                          <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => doRollback(v)} loading={rollback.isPending}>
                            <RotateCcw className="h-4 w-4" /> Restore as new draft
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SnapRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-tertiary">{label}</span>
      <span className="truncate text-ink-primary">{value ?? "—"}</span>
    </div>
  );
}
