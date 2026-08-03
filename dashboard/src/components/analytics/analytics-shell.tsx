"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { makeRange, type DateRange, type RangePreset } from "@/data/analytics";
import { usePermissions } from "@/providers/permission-provider";
import { cn } from "@/lib/utils";

const TABS: { href: string; label: string; roles?: string[] }[] = [
  { href: "/analytics", label: "Overview" },
  { href: "/analytics/health", label: "Hotel Health" },
  { href: "/analytics/ai", label: "AI", roles: ["platform_admin", "hotel_admin", "editor", "read_only"] },
  { href: "/analytics/content", label: "Content", roles: ["platform_admin", "hotel_admin", "editor", "read_only"] },
  { href: "/analytics/reception", label: "Reception", roles: ["platform_admin", "hotel_admin", "reception", "read_only"] },
  { href: "/analytics/stays", label: "Guests & Stays", roles: ["platform_admin", "hotel_admin", "reception", "read_only"] },
  { href: "/analytics/assets", label: "Assets" },
  { href: "/analytics/newsletter", label: "Newsletter", roles: ["platform_admin", "hotel_admin", "marketing", "read_only"] },
];

/** Range from the URL (?range, ?from, ?to). Shared across analytics tabs. */
export function useRangeFromUrl(): DateRange {
  const params = useSearchParams();
  const preset = (params.get("range") as RangePreset) ?? "30d";
  return makeRange(preset, { from: params.get("from") ?? "", to: params.get("to") ?? "" });
}

export function AnalyticsShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { role } = usePermissions();
  const qs = params.toString();
  const withQs = (href: string) => (qs ? `${href}?${qs}` : href);
  const tabs = TABS.filter((t) => !t.roles || (role && t.roles.includes(role)));

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] leading-tight text-ink-primary">{title}</h1>
          {subtitle && <p className="mt-1 text-[14px] text-ink-secondary">{subtitle}</p>}
        </div>
        <RangePicker />
      </div>
      <div className="mb-5 flex flex-wrap gap-1 border-b border-border-subtle">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <Link key={t.href} href={withQs(t.href)} className={cn("relative px-3 py-2 text-[13px] font-medium transition-colors", active ? "text-ink-primary" : "text-ink-tertiary hover:text-ink-secondary")}>
              {t.label}{active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-cream" />}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}

export function RangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const preset = (params.get("range") as RangePreset) ?? "30d";
  const [customOpen, setCustomOpen] = React.useState(preset === "custom");

  const set = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) { if (v == null) p.delete(k); else p.set(k, v); }
    router.replace(`${pathname}?${p.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="inline-flex rounded-md border border-border-strong bg-surface-sunken p-0.5">
        {(["today", "7d", "30d"] as const).map((r) => (
          <button key={r} onClick={() => { setCustomOpen(false); set({ range: r, from: null, to: null }); }} className={cn("rounded px-2.5 py-1 text-[12px] font-medium transition-colors", preset === r ? "bg-brand-navy text-brand-creamSoft" : "text-ink-tertiary hover:text-ink-secondary")}>
            {r === "today" ? "Today" : r === "7d" ? "7 days" : "30 days"}
          </button>
        ))}
        <button onClick={() => { setCustomOpen((o) => !o); set({ range: "custom" }); }} className={cn("rounded px-2.5 py-1 text-[12px] font-medium transition-colors", preset === "custom" ? "bg-brand-navy text-brand-creamSoft" : "text-ink-tertiary hover:text-ink-secondary")}>Custom</button>
      </div>
      {customOpen && (
        <div className="flex items-center gap-1.5">
          <input type="date" defaultValue={params.get("from") ?? ""} onChange={(e) => set({ range: "custom", from: e.target.value })} className="h-8 rounded-md border border-border-strong bg-surface-sunken px-2 text-[12px] text-ink-primary focus-visible:outline-none" />
          <span className="text-ink-tertiary">–</span>
          <input type="date" defaultValue={params.get("to") ?? ""} onChange={(e) => set({ range: "custom", to: e.target.value })} className="h-8 rounded-md border border-border-strong bg-surface-sunken px-2 text-[12px] text-ink-primary focus-visible:outline-none" />
        </div>
      )}
    </div>
  );
}
