"use client";

import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Design System §6 — Metric card: the number is the hero, the label whispers. */
export function KpiCard({
  label,
  value,
  suffix,
  hint,
  icon: Icon,
  tone = "neutral",
  href,
}: {
  label: string;
  value: React.ReactNode;
  suffix?: string;
  hint?: string;
  icon: LucideIcon;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  href?: string;
}) {
  const toneText =
    tone === "success" ? "text-success"
    : tone === "warning" ? "text-warning"
    : tone === "danger" ? "text-danger"
    : tone === "info" ? "text-info"
    : "text-ink-primary";

  const body = (
    <Card className="group h-full p-5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-overlay text-ink-secondary">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        {href && (
          <ArrowUpRight className="h-4 w-4 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>
      <div className="mt-4">
        <div className={cn("flex items-baseline gap-1 font-display text-[30px] leading-none tabular-nums", toneText)}>
          {value}
          {suffix && <span className="text-[15px] text-ink-tertiary">{suffix}</span>}
        </div>
        <div className="mt-2 text-[13px] font-medium text-ink-secondary">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-ink-tertiary">{hint}</div>}
      </div>
    </Card>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}
