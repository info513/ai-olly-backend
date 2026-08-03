"use client";

import * as React from "react";
import { UploadCloud, AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { VisibilityChips } from "./pills";
import { humanizeError } from "@/data/errors";
import type { HotelService } from "@/data/types";

/**
 * Publish sheet (Design System §11). Shows the diff-of-consequence: visibility
 * targets, validity, and — for critical content — a required acknowledgement the
 * editor cannot bypass (the RPC also enforces it server-side).
 */
export function PublishSheet({
  open, onOpenChange, service, onPublish, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  service: HotelService;
  onPublish: (changeSummary: string, acknowledgeCritical: boolean) => Promise<void>;
  pending?: boolean;
}) {
  const [summary, setSummary] = React.useState("");
  const [ack, setAck] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => { if (open) { setSummary(""); setAck(false); setError(null); } }, [open]);

  const submit = async () => {
    setError(null);
    try {
      await onPublish(summary.trim(), ack);
      onOpenChange(false);
    } catch (e) { setError(humanizeError(e)); }
  };

  const validity = service.valid_from || service.valid_to
    ? `${service.valid_from ? new Date(service.valid_from).toLocaleDateString() : "always"} – ${service.valid_to ? new Date(service.valid_to).toLocaleDateString() : "no end"}`
    : "Permanent (no end date)";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish “{service.title}”</DialogTitle>
          <DialogDescription>This goes live to guests immediately. A version snapshot is saved.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Change summary (optional)</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
              placeholder="What changed and why?"
              className="w-full resize-y rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-ink-primary placeholder:text-ink-tertiary focus-visible:border-brand-goldDeep focus-visible:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-md border border-border-subtle bg-surface-base p-3 text-[12px]">
            <div>
              <div className="mb-1 text-ink-tertiary">Visible to</div>
              <VisibilityChips pwa={service.visible_in_pwa} web={service.visible_in_web} ai={service.available_to_ai} />
            </div>
            <div>
              <div className="mb-1 text-ink-tertiary">Validity</div>
              <div className="text-ink-primary">{validity}</div>
            </div>
          </div>

          {service.is_critical && (
            <label className="flex items-start gap-2.5 rounded-md border border-danger/30 bg-danger-soft/40 p-3">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[color:var(--danger)]" />
              <span className="text-[13px] text-ink-secondary">
                <span className="flex items-center gap-1.5 font-medium text-danger"><AlertTriangle className="h-3.5 w-3.5" /> Critical content</span>
                I confirm this check-in / safety / payment information is correct.
              </span>
            </label>
          )}

          {error && <p className="text-[12px] text-danger">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" onClick={submit} loading={pending} disabled={service.is_critical && !ack}>
              <UploadCloud className="h-4 w-4" /> Publish to guests
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
