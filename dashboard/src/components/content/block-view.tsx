"use client";

import { Phone, Mail, MessageCircle, ExternalLink, Info, AlertTriangle } from "lucide-react";
import type { Block, BlockBody } from "@/data/types";

/** Renders structured blocks the way the guest would see them (Dashboard preview only). */
export function BlockView({ body }: { body: BlockBody | null | undefined }) {
  const blocks = body?.blocks ?? [];
  if (!blocks.length) return <p className="text-[13px] italic text-ink-tertiary">No content yet.</p>;
  return (
    <div className="space-y-3 text-[14px] leading-relaxed text-ink-secondary">
      {blocks.map((b, i) => <BlockItem key={i} block={b} />)}
    </div>
  );
}

function BlockItem({ block }: { block: Block }) {
  switch (block.type) {
    case "paragraph":
      return <p>{block.text}</p>;
    case "heading":
      return <p className="font-display text-[17px] text-ink-primary">{block.text}</p>;
    case "bullet_list":
      return (
        <ul className="list-disc space-y-1 pl-5">
          {(block.items ?? []).map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      );
    case "price_list":
      return (
        <div className="divide-y divide-border-subtle overflow-hidden rounded-md border border-border-subtle">
          {(block.items ?? []).map((it, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2">
              <span className="text-ink-primary">{it.label}{it.note && <span className="ml-2 text-[12px] text-ink-tertiary">{it.note}</span>}</span>
              <span className="font-medium tabular-nums text-brand-creamSoft">{it.price}</span>
            </div>
          ))}
        </div>
      );
    case "callout":
      return (
        <div className={`flex gap-2 rounded-md border px-3 py-2 text-[13px] ${block.style === "warning" ? "border-warning/30 bg-warning-soft/40 text-warning" : "border-info/30 bg-info-soft/40 text-info"}`}>
          {block.style === "warning" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{block.text}</span>
        </div>
      );
    case "link":
      return (
        <a className="inline-flex items-center gap-1 text-info hover:underline" href={block.url} target="_blank" rel="noreferrer">
          {block.label || block.url} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      );
    case "contact_action": {
      const Icon = block.action === "email" ? Mail : block.action === "whatsapp" ? MessageCircle : Phone;
      return (
        <span className="inline-flex items-center gap-2 rounded-md border border-border-strong bg-surface-overlay px-3 py-1.5 text-[13px] text-ink-primary">
          <Icon className="h-4 w-4 text-brand-cream" /> {block.label || block.value}
        </span>
      );
    }
    case "divider":
      return <hr className="border-border-subtle" />;
    default:
      return null;
  }
}
