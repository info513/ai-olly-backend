"use client";

import * as React from "react";
import { UploadCloud, AlertTriangle, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScopeBadge, AiChip } from "./ai-pills";
import { humanizeError } from "@/data/errors";
import type { KnowledgeArticle } from "@/data/ai-types";

/**
 * Publish dialog for a knowledge article (Part 6). Shows the consequence summary:
 * scope, locale, validity, AI-availability, critical status. Critical articles
 * require an explicit acknowledgement the RPC also enforces server-side.
 */
export function KnowledgePublishSheet({
  open, onOpenChange, article, onPublish, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  article: KnowledgeArticle;
  onPublish: (changeSummary: string, acknowledgeCritical: boolean) => Promise<void>;
  pending?: boolean;
}) {
  const [summary, setSummary] = React.useState("");
  const [ack, setAck] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setSummary(""); setAck(false); setError(null); } }, [open]);

  const submit = async () => {
    setError(null);
    try { await onPublish(summary.trim(), ack); onOpenChange(false); }
    catch (e) { setError(humanizeError(e)); }
  };

  const validity = article.valid_from || article.valid_to
    ? `${article.valid_from ? new Date(article.valid_from).toLocaleDateString() : "always"} – ${article.valid_to ? new Date(article.valid_to).toLocaleDateString() : "no end"}`
    : "Permanent (no end date)";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish “{article.title}”</DialogTitle>
          <DialogDescription>This updates what the AI answers with immediately. A version snapshot is saved.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Change summary (optional)</label>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} placeholder="What changed and why?"
              className="w-full resize-y rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-ink-primary placeholder:text-ink-tertiary focus-visible:border-brand-goldDeep focus-visible:outline-none" />
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-md border border-border-subtle bg-surface-base p-3 text-[12px]">
            <SummaryCell label="Scope"><ScopeBadge scope={article.source_type} /></SummaryCell>
            <SummaryCell label="Locale"><span className="font-mono text-ink-primary">{article.locale}</span></SummaryCell>
            <SummaryCell label="Availability"><AiChip on={article.available_to_ai} /></SummaryCell>
            <SummaryCell label="Validity"><span className="text-ink-primary">{validity}</span></SummaryCell>
          </div>

          {article.available_to_ai && !article.approved_answer && (
            <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft/40 px-3 py-2 text-[12px] text-warning">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" /> No approved answer set — the AI will fall back to the structured content for this article.
            </p>
          )}

          {article.is_critical && (
            <label className="flex items-start gap-2.5 rounded-md border border-danger/30 bg-danger-soft/40 p-3">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[color:var(--danger)]" />
              <span className="text-[13px] text-ink-secondary">
                <span className="flex items-center gap-1.5 font-medium text-danger"><AlertTriangle className="h-3.5 w-3.5" /> Critical content</span>
                I confirm this safety / emergency / policy information is correct.
              </span>
            </label>
          )}

          {error && <p className="text-[12px] text-danger">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" onClick={submit} loading={pending} disabled={article.is_critical && !ack}>
              <UploadCloud className="h-4 w-4" /> Publish
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-ink-tertiary">{label}</div>
      {children}
    </div>
  );
}
