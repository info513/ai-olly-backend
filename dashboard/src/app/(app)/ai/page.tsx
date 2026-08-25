"use client";

import Link from "next/link";
import { BookOpen, MessageSquareWarning, Sparkles, AlertTriangle, FileText, CheckCircle2, ArrowRight, PlayCircle, Plus, Gauge } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useKnowledgeArticles, useResolvedKnowledge } from "@/data/knowledge";
import { useUnanswered } from "@/data/unanswered";
import { useQualityDaily, computeQualityMetrics, computeCoverage, computeKnowledgeHealth } from "@/data/ai-quality";
import { PageHeader } from "@/components/content/page-header";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/utils";

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);

export default function AiHome() {
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const articlesQ = useKnowledgeArticles(currentHotel?.id);
  const unansweredQ = useUnanswered(currentHotel?.id);
  const resolvedQ = useResolvedKnowledge(currentHotel?.id, "en", false);
  const qualityQ = useQualityDaily(currentHotel?.id);

  const articles = articlesQ.data ?? [];
  const unanswered = unansweredQ.data ?? [];
  const health = computeKnowledgeHealth(articles, unanswered);
  const coverage = computeCoverage(resolvedQ.data ?? [], unanswered);
  const metrics = computeQualityMetrics(qualityQ.data ?? []);
  const handoff = metrics.find((m) => m.key === "handoff_rate")?.value ?? null;

  const recentlyPublished = [...articles]
    .filter((a) => a.status === "published" && a.published_at)
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
    .slice(0, 5);

  const canAuthor = role === "platform_admin" || role === "hotel_admin" || role === "editor";
  const loading = articlesQ.isLoading || unansweredQ.isLoading;

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader
        title="Olly"
        subtitle={`How Olly answers ${currentHotel?.name ?? "your hotel"}'s guests — what it knows, what it couldn't answer, and a place to try it.`}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/ai/preview" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong px-3 text-[13px] font-medium text-ink-secondary hover:text-ink-primary"><PlayCircle className="h-4 w-4" /> Try Olly</Link>
            {canAuthor && <Link href="/ai/knowledge/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[13px] font-semibold text-brand-navy hover:bg-brand-creamSoft"><Plus className="h-4 w-4" /> Add answer</Link>}
          </div>
        }
      />

      {/* Priority metric row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={Gauge} tone="info" label="What Olly can answer" value={loading ? null : pct(coverage.value)}
          hint={`${coverage.resolvedCount} live answers · ${coverage.openUnanswered} open gaps`} href="/ai/quality" />
        <Metric icon={MessageSquareWarning} tone={health.unresolvedUnanswered ? "warning" : "neutral"} label="Questions Olly couldn't answer"
          value={loading ? null : String(health.unresolvedUnanswered)} hint="Guest questions with no answer yet" href="/ai/unanswered" />
        <Metric icon={Sparkles} tone="neutral" label="Handed to reception" value={qualityQ.isLoading ? null : pct(handoff)}
          hint="Questions Olly passed to a person" href="/ai/quality" />
        <Metric icon={AlertTriangle} tone={health.expiredCritical ? "danger" : "neutral"} label="Answers past their date"
          value={loading ? null : String(health.expiredCritical)} hint="Important answers that need refreshing" href="/ai/knowledge?filter=expired-critical" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Drafts / attention */}
        <Card className="p-5">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Waiting for you</div>
          <div className="space-y-2.5">
            <AttentionRow icon={FileText} label="Drafts to review" value={loading ? null : health.draftCount} href="/ai/knowledge?status=draft" />
            <AttentionRow icon={AlertTriangle} label="Critical, not yet published" value={loading ? null : health.criticalPending} href="/ai/knowledge?filter=critical-pending" tone={health.criticalPending ? "danger" : undefined} />
            <AttentionRow icon={Sparkles} label="Shown to guests, no approved answer" value={loading ? null : health.missingApprovedAnswer} href="/ai/knowledge?filter=missing-answer" tone={health.missingApprovedAnswer ? "warning" : undefined} />
          </div>
        </Card>

        {/* Recently published */}
        <Card className="p-5">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Recently published</div>
          {loading ? (
            <Skeleton className="h-20 w-full" />
          ) : recentlyPublished.length === 0 ? (
            <p className="text-[13px] text-ink-tertiary">Nothing published yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentlyPublished.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-[13px]">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  <Link href={`/ai/knowledge/${a.id}`} className="min-w-0 flex-1 truncate text-ink-primary hover:underline">{a.title}</Link>
                  <span className="shrink-0 text-[11px] text-ink-tertiary">{a.published_at ? relativeTime(a.published_at) : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Quick actions */}
        <Card className="p-5">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Quick actions</div>
          <div className="space-y-2">
            <QuickAction icon={PlayCircle} label="Try Olly" desc="Ask a question, see the live answer" href="/ai/preview" />
            {canAuthor && <QuickAction icon={Plus} label="Add an answer" desc="Teach Olly something new" href="/ai/knowledge/new" />}
            <QuickAction icon={MessageSquareWarning} label="Questions Olly couldn't answer" desc="Turn gaps into answers" href="/ai/unanswered" />
            <QuickAction icon={BookOpen} label="What Olly knows" desc="Everything Olly can tell guests" href="/ai/knowledge" />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, tone, label, value, hint, href }: { icon: typeof Gauge; tone: "info" | "warning" | "danger" | "neutral"; label: string; value: string | null; hint: string; href: string }) {
  const color = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "info" ? "text-info" : "text-ink-primary";
  return (
    <Link href={href}>
      <Card className="h-full p-5 transition-colors hover:border-border-strong">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-overlay text-ink-secondary"><Icon className="h-[18px] w-[18px]" /></span>
        <div className={`mt-3 font-display text-[28px] leading-none tabular-nums ${color}`}>{value === null ? <Skeleton className="h-7 w-12" /> : value}</div>
        <div className="mt-1.5 text-[13px] text-ink-secondary">{label}</div>
        <div className="mt-0.5 text-[11px] text-ink-tertiary">{hint}</div>
      </Card>
    </Link>
  );
}

function AttentionRow({ icon: Icon, label, value, href, tone }: { icon: typeof FileText; label: string; value: number | null; href: string; tone?: "danger" | "warning" }) {
  const color = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-ink-primary";
  return (
    <Link href={href} className="flex items-center gap-3 rounded-md border border-border-subtle px-3 py-2 transition-colors hover:border-border-strong">
      <Icon className="h-4 w-4 shrink-0 text-ink-tertiary" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{label}</span>
      <span className={`shrink-0 font-display text-[16px] tabular-nums ${color}`}>{value === null ? "—" : value}</span>
    </Link>
  );
}

function QuickAction({ icon: Icon, label, desc, href }: { icon: typeof PlayCircle; label: string; desc: string; href: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-md border border-border-subtle px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-surface-overlay/40">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-navy text-brand-cream"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink-primary">{label}</span>
        <span className="block truncate text-[11px] text-ink-tertiary">{desc}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
