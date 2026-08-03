"use client";

import * as React from "react";
import { Info, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Dependency-free, accessible SVG charts (Design System §15 / Part 15). Responsive
// via viewBox; tooltips via native <title>; honest empty states; axes start at 0.

export interface Point { label: string; value: number }

/** Tiny inline sparkline for tiles. */
export function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 100, h = 28;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-7 w-full", className)} aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Line chart with baseline, min/max, and hoverable points. */
export function TrendChart({ points, height = 160, unit = "", title }: { points: Point[]; height?: number; unit?: string; title?: string }) {
  if (points.length === 0) return <ChartEmpty />;
  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const w = 600, h = height, padL = 4, padR = 4, padT = 8, padB = 18;
  const iw = w - padL - padR, ih = h - padT - padB;
  const x = (i: number) => padL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => padT + ih - (v / max) * ih;
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const area = `${padL},${padT + ih} ${line} ${padL + iw},${padT + ih}`;
  const ticks = points.length > 12 ? points.filter((_, i) => i % Math.ceil(points.length / 6) === 0) : points;

  return (
    <div>
      {title && <div className="mb-1 text-[12px] font-medium text-ink-secondary">{title}</div>}
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={title ?? "trend chart"} style={{ height }}>
        <line x1={padL} y1={padT + ih} x2={padL + iw} y2={padT + ih} stroke="var(--border-subtle)" strokeWidth="1" />
        <polygon points={area} fill="var(--brand-cream)" opacity="0.08" />
        <polyline points={line} fill="none" stroke="var(--brand-cream)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r="2" fill="var(--brand-cream)" />
            <title>{p.label}: {p.value}{unit}</title>
          </g>
        ))}
        {ticks.map((p, i) => <text key={i} x={x(points.indexOf(p))} y={h - 4} textAnchor="middle" className="fill-[color:var(--ink-tertiary)] text-[9px]">{p.label}</text>)}
      </svg>
    </div>
  );
}

/** Horizontal bar list (for distributions / top-N). */
export function BarList({ items, unit = "" }: { items: { label: string; value: number }[]; unit?: string }) {
  if (items.length === 0) return <ChartEmpty />;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2 text-[12px]">
          <span className="w-28 shrink-0 truncate text-ink-secondary" title={it.label}>{it.label}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-overlay">
            <div className="h-full rounded-full bg-brand-cream/70" style={{ width: `${(it.value / max) * 100}%` }} />
          </div>
          <span className="w-12 shrink-0 text-right tabular-nums text-ink-primary">{it.value}{unit}</span>
        </div>
      ))}
    </div>
  );
}

function ChartEmpty() {
  return <div className="grid h-32 place-items-center rounded-md border border-dashed border-border-subtle text-[12px] text-ink-tertiary">Not enough data yet</div>;
}

/** Delta vs previous period (honest: null when comparison isn't available). */
export function Delta({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value == null) return <span className="text-[11px] text-ink-tertiary">no prior data</span>;
  if (Math.abs(value) < 0.5) return <span className="inline-flex items-center gap-0.5 text-[11px] text-ink-tertiary"><Minus className="h-3 w-3" /> flat</span>;
  const good = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? ArrowUp : ArrowDown;
  return <span className={cn("inline-flex items-center gap-0.5 text-[11px]", good ? "text-success" : "text-danger")}><Icon className="h-3 w-3" /> {Math.abs(Math.round(value))}%</span>;
}

/** KPI tile with optional formula, sparkline, delta and link. */
export function MetricTile({ label, value, unit = "", formula, spark, delta, invertDelta, tone = "neutral", href }: {
  label: string; value: string | number; unit?: string; formula?: string; spark?: number[]; delta?: number | null; invertDelta?: boolean;
  tone?: "neutral" | "info" | "success" | "warning" | "danger"; href?: string;
}) {
  const color = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : tone === "info" ? "text-info" : "text-ink-primary";
  const inner = (
    <Card className="h-full p-4 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] text-ink-tertiary">{label}</span>
        {delta !== undefined && <Delta value={delta} invert={invertDelta} />}
      </div>
      <div className={`mt-1.5 font-display text-[26px] leading-none tabular-nums ${color}`}>{value}{unit}</div>
      {spark && spark.length > 1 && <div className="mt-2 text-brand-cream/50"><Sparkline data={spark} /></div>}
      {formula && <div className="mt-2 flex items-start gap-1 font-mono text-[10px] text-ink-tertiary"><Info className="mt-0.5 h-2.5 w-2.5 shrink-0" /> <span>{formula}</span></div>}
    </Card>
  );
  return href ? <a href={href} className="block">{inner}</a> : inner;
}
