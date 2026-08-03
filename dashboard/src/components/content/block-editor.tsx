"use client";

import * as React from "react";
import { Plus, Trash2, ChevronUp, ChevronDown, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Block, BlockBody } from "@/data/types";

/**
 * A lightweight, block-based structured editor. Emits exactly the validated
 * block shape (paragraph/heading/bullet_list/price_list/callout/link/
 * contact_action/divider) — never raw HTML. Deliberately simple and robust.
 */
const BLOCK_TYPES: { type: Block["type"]; label: string }[] = [
  { type: "paragraph", label: "Paragraph" },
  { type: "heading", label: "Heading" },
  { type: "bullet_list", label: "Bullet list" },
  { type: "price_list", label: "Price list" },
  { type: "callout", label: "Callout" },
  { type: "link", label: "Link" },
  { type: "contact_action", label: "Contact action" },
  { type: "divider", label: "Divider" },
];

function emptyBlock(type: Block["type"]): Block {
  switch (type) {
    case "bullet_list": return { type, items: [""] };
    case "price_list": return { type, items: [{ label: "", price: "" }] };
    case "callout": return { type, style: "info", text: "" };
    case "link": return { type, label: "", url: "" };
    case "contact_action": return { type, action: "call", value: "", label: "" };
    case "heading": return { type, level: 2, text: "" };
    case "divider": return { type };
    default: return { type: "paragraph", text: "" };
  }
}

export function BlockEditor({
  body, onChange, disabled,
}: { body: BlockBody | null; onChange: (b: BlockBody) => void; disabled?: boolean }) {
  const blocks = body?.blocks ?? [];
  const set = (next: Block[]) => onChange({ version: body?.version ?? 1, blocks: next });
  const update = (i: number, b: Block) => set(blocks.map((x, j) => (j === i ? b : x)));
  const remove = (i: number) => set(blocks.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };
  const add = (type: Block["type"]) => set([...blocks, emptyBlock(type)]);

  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => (
        <div key={i} className="rounded-md border border-border-subtle bg-surface-base">
          <div className="flex items-center justify-between border-b border-border-subtle px-2.5 py-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">
              <GripVertical className="h-3.5 w-3.5" /> {b.type.replace("_", " ")}
            </span>
            {!disabled && (
              <span className="flex items-center gap-0.5">
                <button onClick={() => move(i, -1)} className="rounded p-1 text-ink-tertiary hover:text-ink-primary"><ChevronUp className="h-3.5 w-3.5" /></button>
                <button onClick={() => move(i, 1)} className="rounded p-1 text-ink-tertiary hover:text-ink-primary"><ChevronDown className="h-3.5 w-3.5" /></button>
                <button onClick={() => remove(i)} className="rounded p-1 text-ink-tertiary hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
              </span>
            )}
          </div>
          <div className="p-2.5">
            <BlockFields block={b} onChange={(nb) => update(i, nb)} disabled={disabled} />
          </div>
        </div>
      ))}

      {!disabled && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-center border border-dashed border-border-subtle">
              <Plus className="h-4 w-4" /> Add block
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-56">
            <DropdownMenuLabel>Add a block</DropdownMenuLabel>
            {BLOCK_TYPES.map((t) => (
              <DropdownMenuItem key={t.type} onSelect={() => add(t.type)}>{t.label}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function Ta(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={2}
      {...props}
      className="w-full resize-y rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-ink-primary placeholder:text-ink-tertiary focus-visible:border-brand-goldDeep focus-visible:outline-none disabled:opacity-50"
    />
  );
}

function BlockFields({ block, onChange, disabled }: { block: Block; onChange: (b: Block) => void; disabled?: boolean }) {
  switch (block.type) {
    case "paragraph":
      return <Ta value={block.text ?? ""} disabled={disabled} placeholder="Write a paragraph…" onChange={(e) => onChange({ ...block, text: e.target.value })} />;
    case "heading":
      return <Input value={block.text ?? ""} disabled={disabled} placeholder="Heading text" onChange={(e) => onChange({ ...block, text: e.target.value })} />;
    case "bullet_list":
      return (
        <Ta
          value={(block.items ?? []).join("\n")}
          disabled={disabled}
          placeholder="One item per line"
          onChange={(e) => onChange({ ...block, items: e.target.value.split("\n").map((s) => s).filter((s) => s.length) })}
        />
      );
    case "price_list":
      return (
        <div className="space-y-2">
          {(block.items ?? []).map((it, i) => (
            <div key={i} className="flex gap-2">
              <Input className="flex-1" value={it.label ?? ""} disabled={disabled} placeholder="Item" onChange={(e) => {
                const items = [...(block.items ?? [])]; items[i] = { ...items[i], label: e.target.value }; onChange({ ...block, items });
              }} />
              <Input className="w-28" value={it.price ?? ""} disabled={disabled} placeholder="€0" onChange={(e) => {
                const items = [...(block.items ?? [])]; items[i] = { ...items[i], price: e.target.value }; onChange({ ...block, items });
              }} />
            </div>
          ))}
          {!disabled && (
            <button onClick={() => onChange({ ...block, items: [...(block.items ?? []), { label: "", price: "" }] })} className="text-[12px] text-ink-tertiary hover:text-brand-cream">+ Add price row</button>
          )}
        </div>
      );
    case "callout":
      return (
        <div className="space-y-2">
          <div className="flex gap-1.5">
            {(["info", "warning"] as const).map((s) => (
              <button key={s} disabled={disabled} onClick={() => onChange({ ...block, style: s })}
                className={cn("rounded px-2 py-1 text-[11px] capitalize", block.style === s ? "bg-brand-navy text-brand-creamSoft" : "bg-surface-overlay text-ink-tertiary")}>{s}</button>
            ))}
          </div>
          <Ta value={block.text ?? ""} disabled={disabled} placeholder="Callout text" onChange={(e) => onChange({ ...block, text: e.target.value })} />
        </div>
      );
    case "link":
      return (
        <div className="flex gap-2">
          <Input className="flex-1" value={block.label ?? ""} disabled={disabled} placeholder="Label" onChange={(e) => onChange({ ...block, label: e.target.value })} />
          <Input className="flex-1" value={block.url ?? ""} disabled={disabled} placeholder="https://…" onChange={(e) => onChange({ ...block, url: e.target.value })} />
        </div>
      );
    case "contact_action":
      return (
        <div className="space-y-2">
          <div className="flex gap-1.5">
            {(["call", "email", "whatsapp"] as const).map((a) => (
              <button key={a} disabled={disabled} onClick={() => onChange({ ...block, action: a })}
                className={cn("rounded px-2 py-1 text-[11px] capitalize", block.action === a ? "bg-brand-navy text-brand-creamSoft" : "bg-surface-overlay text-ink-tertiary")}>{a}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input className="flex-1" value={block.label ?? ""} disabled={disabled} placeholder="Label" onChange={(e) => onChange({ ...block, label: e.target.value })} />
            <Input className="flex-1" value={block.value ?? ""} disabled={disabled} placeholder="Number / email" onChange={(e) => onChange({ ...block, value: e.target.value })} />
          </div>
        </div>
      );
    case "divider":
      return <p className="text-[12px] italic text-ink-tertiary">A visual divider.</p>;
    default:
      return null;
  }
}
