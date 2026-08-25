"use client";

import Link from "next/link";
import { BedDouble, ConciergeBell, FileText, AlertTriangle, ArrowRight, CheckCircle2, Images, Sparkles, Zap, UploadCloud } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useContentSummary } from "@/data/content";
import { PageHeader } from "@/components/content/page-header";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/content/states";
import { relativeTime } from "@/lib/utils";

export default function ContentLanding() {
  const { currentHotel } = useHotel();
  const { data, isLoading, isError, error, refetch } = useContentSummary(currentHotel?.id);

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader
        title="Hotel Content"
        subtitle={`Everything guests see about ${currentHotel?.name ?? "your hotel"} in Olly. Change it here and it reaches the guest app.`}
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <ModuleCard
              href="/content/rooms" icon={BedDouble} title="Rooms & Room Guide" live
              desc="Room details, Wi-Fi, equipment and the guest Room Guide. Room rates live here too."
              stat={isLoading ? null : `${data?.roomCount ?? 0} rooms · ${data?.roomTypeCount ?? 0} types`}
            />
            <ModuleCard
              href="/content/services" icon={ConciergeBell} title="Services" live={false}
              desc="Breakfast, transfers, extras and their prices — draft, preview, then publish."
              stat={isLoading ? null : `${data?.serviceCount ?? 0} services`}
            />
            <ModuleCard
              href="/assets" icon={Images} title="Photos & Media" live
              desc="Images and files used across your hotel content."
              stat="Library"
            />
            <ModuleCard
              href="/presentation" icon={Sparkles} title="Recommendations" live
              desc="How your hotel presents Split's places, routes and events to guests."
              stat="Maintained by AI OLLY Platform · you control presentation"
            />
          </div>

          {/* Attention row — services publishing pipeline */}
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <StatTile icon={FileText} tone="info" label="Drafts waiting" value={isLoading ? null : data?.draftsWaiting ?? 0} href="/content/services?status=draft" />
            <StatTile icon={AlertTriangle} tone="danger" label="Critical needs attention" value={isLoading ? null : data?.criticalNeedsAttention ?? 0} href="/content/services?critical=1" />
            <Card className="p-5">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Recently published</div>
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (data?.recentlyPublished ?? []).length === 0 ? (
                <p className="text-[13px] text-ink-tertiary">Nothing published yet.</p>
              ) : (
                <ul className="space-y-2">
                  {data!.recentlyPublished.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 text-[13px]">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                      <Link href={`/content/services/${s.id}`} className="min-w-0 flex-1 truncate text-ink-primary hover:underline">{s.title}</Link>
                      <span className="shrink-0 text-[11px] text-ink-tertiary">{s.published_at ? relativeTime(s.published_at) : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="mt-4 flex items-center gap-2 text-[12px] text-ink-tertiary">
            <UploadCloud className="h-4 w-4" />
            Rooms, rates and photos go live the moment you save. Services go live when you publish.
          </div>
        </>
      )}
    </div>
  );
}

/** `live` = changes are live on save; otherwise the area uses a draft → publish flow. */
function ModuleCard({ href, icon: Icon, title, desc, stat, live }: { href: string; icon: typeof BedDouble; title: string; desc: string; stat: string | null; live: boolean }) {
  return (
    <Link href={href}>
      <Card className="group h-full p-5 transition-colors hover:border-border-strong">
        <div className="flex items-start justify-between">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-navy text-brand-cream">
            <Icon className="h-5 w-5" />
          </span>
          {live ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success"><Zap className="h-3 w-3" /> Live on save</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-info/15 px-2 py-0.5 text-[10px] font-medium text-info"><FileText className="h-3 w-3" /> Requires publish</span>
          )}
        </div>
        <div className="mt-4 flex items-center gap-2 font-display text-[20px] text-ink-primary">{title}<ArrowRight className="h-4 w-4 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" /></div>
        <p className="mt-1 text-[13px] text-ink-secondary">{desc}</p>
        <div className="mt-3 text-[12px] text-ink-tertiary">{stat ?? <Skeleton className="h-4 w-24" />}</div>
      </Card>
    </Link>
  );
}

function StatTile({ icon: Icon, tone, label, value, href }: { icon: typeof FileText; tone: "info" | "danger"; label: string; value: number | null; href: string }) {
  const color = tone === "danger" ? "text-danger" : "text-info";
  return (
    <Link href={href}>
      <Card className="p-5 transition-colors hover:border-border-strong">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-overlay text-ink-secondary"><Icon className="h-[18px] w-[18px]" /></span>
        <div className={`mt-3 font-display text-[28px] leading-none tabular-nums ${value ? color : "text-ink-primary"}`}>
          {value === null ? <Skeleton className="h-7 w-10" /> : value}
        </div>
        <div className="mt-1.5 text-[13px] text-ink-secondary">{label}</div>
      </Card>
    </Link>
  );
}
