"use client";

import Link from "next/link";
import { Images, Upload, ImageOff, Copyright, Link2Off, HardDrive, Lock, ArrowRight, Plus } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useAssetsSummary } from "@/data/assets";
import { humanBytes } from "@/data/asset-constants";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState } from "@/components/content/states";
import { AssetThumb } from "@/components/assets/asset-preview";
import { AssetLibrary } from "@/components/assets/asset-library";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/utils";
import type { AssetSummary } from "@/data/asset-types";

export default function AssetsHome() {
  const { currentHotel } = useHotel();
  const q = useAssetsSummary(currentHotel?.id);
  const d = q.data;

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader
        title="Assets"
        subtitle={`Media library and files for ${currentHotel?.name ?? "your hotel"}.`}
        actions={<Link href="/assets/upload" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[13px] font-semibold text-brand-navy hover:bg-brand-creamSoft"><Plus className="h-4 w-4" /> Upload</Link>}
      />

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading || !d ? <SectionLoader rows={5} />
        : (
        <>
          {/* Attention strip */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat icon={Images} label="Assets" value={d.total} href="/assets" tone="muted" />
            <Stat icon={Link2Off} label="Unused" value={d.unused.length} href="/assets/usage?filter=unused" tone={d.unused.length ? "warning" : "muted"} />
            <Stat icon={ImageOff} label="Missing alt" value={d.missingAlt.length} href="/assets/images?filter=missing-alt" tone={d.missingAlt.length ? "warning" : "muted"} />
            <Stat icon={Copyright} label="Missing rights" value={d.missingRights.length} href="/assets?filter=missing-rights" tone={d.missingRights.length ? "warning" : "muted"} />
            <Stat icon={HardDrive} label="Storage" value={humanBytes(d.storageBytes)} href="/assets" tone="muted" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Recent */}
            <Card className="p-5 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Recent uploads</span>
                <Link href="/assets" className="text-[12px] text-ink-tertiary hover:text-ink-secondary">Library →</Link>
              </div>
              {d.recent.length === 0 ? <p className="text-[13px] text-ink-tertiary">Nothing yet. <Link href="/assets/upload" className="text-brand-cream hover:underline">Upload →</Link></p> : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {d.recent.map((a) => (
                    <Link key={a.id} href={`/assets/${a.id}`} className="group">
                      <AssetThumb asset={a} className="aspect-[4/3] w-full" />
                      <div className="mt-1.5 truncate text-[12px] text-ink-secondary">{a.displayName}</div>
                      <div className="text-[11px] text-ink-tertiary">{relativeTime(a.createdAt)}</div>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            {/* Quick + consent */}
            <div className="space-y-4">
              <Card className="p-5">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Quick actions</div>
                <div className="space-y-2">
                  <QuickAction icon={Upload} label="Upload asset" href="/assets/upload" />
                  <QuickAction icon={Link2Off} label="Review unused" href="/assets/usage?filter=unused" />
                  <QuickAction icon={ImageOff} label="Add missing alt text" href="/assets/images?filter=missing-alt" />
                </div>
              </Card>
              <Card className="p-5">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary"><Lock className="h-3.5 w-3.5" /> Consent files</div>
                <div className="font-display text-[24px] tabular-nums text-ink-primary">{d.consentFiles}</div>
                <p className="mt-1 text-[12px] text-ink-tertiary">Private signatures & documents.</p>
                <Link href="/assets/documents" className="mt-2 inline-flex items-center gap-1 text-[12px] text-ink-tertiary hover:text-ink-secondary">View private files <ArrowRight className="h-3.5 w-3.5" /></Link>
              </Card>
            </div>
          </div>

          {/* Unused preview */}
          {d.unused.length > 0 && (
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Unused assets</span><Link href="/assets/usage?filter=unused" className="text-[12px] text-ink-tertiary hover:text-ink-secondary">View all →</Link></div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {d.unused.slice(0, 6).map((a) => <UnusedTile key={a.id} a={a} />)}
              </div>
            </div>
          )}

          {/* Full library */}
          <div className="mt-8 border-t border-border-subtle pt-6">
            <h2 className="mb-4 font-display text-[18px] text-ink-primary">Library</h2>
            <AssetLibrary />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, href, tone }: { icon: typeof Images; label: string; value: number | string; href: string; tone: "warning" | "muted" }) {
  const color = tone === "warning" && value ? "text-warning" : "text-ink-primary";
  return (
    <Link href={href}>
      <Card className="p-3.5 transition-colors hover:border-border-strong">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-overlay text-ink-secondary"><Icon className="h-4 w-4" /></span>
        <div className={`mt-2 font-display text-[22px] leading-none tabular-nums ${color}`}>{value === undefined ? <Skeleton className="h-6 w-10" /> : value}</div>
        <div className="mt-1 text-[12px] text-ink-tertiary">{label}</div>
      </Card>
    </Link>
  );
}

function QuickAction({ icon: Icon, label, href }: { icon: typeof Upload; label: string; href: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-md border border-border-subtle px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-surface-overlay/40">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-navy text-brand-cream"><Icon className="h-4 w-4" /></span>
      <span className="flex-1 text-[13px] font-medium text-ink-primary">{label}</span>
      <ArrowRight className="h-4 w-4 shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

function UnusedTile({ a }: { a: AssetSummary }) {
  return (
    <Link href={`/assets/${a.id}`} className="group">
      <AssetThumb asset={a} className="aspect-square w-full" />
      <div className="mt-1 truncate text-[11px] text-ink-tertiary">{a.displayName}</div>
    </Link>
  );
}
