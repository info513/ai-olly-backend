"use client";

import * as React from "react";
import { Monitor, Smartphone, AlertTriangle, Info } from "lucide-react";
import { BlockView } from "@/components/content/block-view";
import { cn } from "@/lib/utils";
import type { BlockBody } from "@/data/types";

/**
 * Dashboard email preview (Part 8). A close approximation — NOT exact rendering
 * parity across email clients. Desktop/mobile frames, subject + preview-text, and
 * content warnings. A standard footer with an unsubscribe line is always shown
 * (the current schema has no footer/image/button block types — see the note).
 */
export function EmailPreview({
  subject, previewText, content, hotelName,
}: { subject: string; previewText: string | null; content: BlockBody | null; hotelName: string }) {
  const [mode, setMode] = React.useState<"desktop" | "mobile">("desktop");

  const blocks = content?.blocks ?? [];
  const warnings: string[] = [];
  if (!subject.trim()) warnings.push("Subject line is empty.");
  if (!previewText?.trim()) warnings.push("Preview text is empty — inboxes will fall back to the first body line.");
  if (blocks.length === 0) warnings.push("The email has no content blocks yet.");
  const hasLink = blocks.some((b) => b.type === "link" || b.type === "contact_action");
  if (!hasLink) warnings.push("No call-to-action link found.");

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="inline-flex rounded-md border border-border-strong bg-surface-sunken p-0.5">
          {([["desktop", Monitor], ["mobile", Smartphone]] as const).map(([m, Icon]) => (
            <button key={m} onClick={() => setMode(m)} className={cn("inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[12px] font-medium capitalize transition-colors", mode === m ? "bg-brand-navy text-brand-creamSoft" : "text-ink-tertiary hover:text-ink-secondary")}>
              <Icon className="h-3.5 w-3.5" /> {m}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-ink-tertiary">Dashboard preview — not exact client rendering</span>
      </div>

      {/* subject + preview line (inbox row) */}
      <div className="mb-3 rounded-md border border-border-subtle bg-surface-base px-3 py-2">
        <div className="text-[13px] font-semibold text-ink-primary">{subject || <span className="italic text-ink-tertiary">No subject</span>}</div>
        <div className="text-[12px] text-ink-tertiary">{previewText || <span className="italic">No preview text</span>}</div>
      </div>

      {/* email body frame (light — emails render on white) */}
      <div className="grid place-items-center rounded-lg border border-border-subtle bg-surface-sunken p-4">
        <div className={cn("w-full overflow-hidden rounded-md bg-white shadow-e1 transition-all", mode === "mobile" ? "max-w-[360px]" : "max-w-[600px]")}>
          <div className="bg-[#1a3445] px-6 py-4 text-center"><span className="font-display text-[18px] text-[#e8d4a0]">{hotelName}</span></div>
          <div className="px-6 py-5 text-[#1a1a1a] [&_*]:!text-[#1a1a1a]">
            <BlockView body={content} />
          </div>
          <div className="border-t border-[#e5e5e5] bg-[#fafafa] px-6 py-4 text-center text-[11px] text-[#888]">
            You received this because you subscribed to {hotelName}.<br />
            <span className="underline">Unsubscribe</span> · <span className="underline">Update preferences</span>
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {warnings.map((w, i) => (
            <p key={i} className="flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning-soft/30 px-3 py-1.5 text-[12px] text-warning"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {w}</p>
          ))}
        </div>
      )}
      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-ink-tertiary"><Info className="mt-0.5 h-3 w-3 shrink-0" /> Image, button, spacer and custom footer blocks aren’t in the current validated schema — a standard footer with an unsubscribe link is added automatically. Those block types are deferred.</p>
    </div>
  );
}
