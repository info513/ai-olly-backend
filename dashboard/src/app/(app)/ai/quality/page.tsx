"use client";

import * as React from "react";
import { Gauge, Info, BookOpen, AlertTriangle } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useKnowledgeArticles, useResolvedKnowledge } from "@/data/knowledge";
import { useUnanswered } from "@/data/unanswered";
import { useQualityDaily, computeQualityMetrics, computeCoverage, computeKnowledgeHealth, type QualityMetric } from "@/data/ai-quality";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { Card } from "@/components/ui/card";

const fmt = (m: QualityMetric) => {
  if (m.value == null) return "—";
  if (m.unit === "percent") return `${Math.round(m.value)}%`;
  if (m.unit === "ms") return `${Math.round(m.value)} ms`;
  return String(Math.round(m.value));
};

export default function AiQualityPage() {
  const { currentHotel } = useHotel();
  const qualityQ = useQualityDaily(currentHotel?.id);
  const articlesQ = useKnowledgeArticles(currentHotel?.id);
  const unansweredQ = useUnanswered(currentHotel?.id);
  const resolvedQ = useResolvedKnowledge(currentHotel?.id, "en", false);

  const rows = qualityQ.data ?? [];
  const metrics = computeQualityMetrics(rows);
  const coverage = computeCoverage(resolvedQ.data ?? [], unansweredQ.data ?? []);
  const health = computeKnowledgeHealth(articlesQ.data ?? [], unansweredQ.data ?? []);

  const totalQuestions = rows.reduce((a, r) => a + r.total_questions, 0);

  return (
    <div className="mx-auto max-w-[1100px] p-6">
      <PageHeader
        crumbs={[{ label: "AI", href: "/ai" }, { label: "Quality" }]}
        title="Olly performance"
        subtitle="Measured from real logs and your live knowledge. Every number shows the exact formula it came from — no mystery scores."
      />

      {qualityQ.isError ? (
        <ErrorState error={qualityQ.error} onRetry={() => qualityQ.refetch()} />
      ) : qualityQ.isLoading ? (
        <SectionLoader rows={5} />
      ) : (
        <>
          {/* Coverage — always computable from live knowledge */}
          <Card className="mb-4 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary"><Gauge className="h-4 w-4" /> Knowledge coverage</div>
                <div className="mt-2 font-display text-[34px] leading-none tabular-nums text-info">{coverage.value == null ? "—" : `${Math.round(coverage.value)}%`}</div>
                <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-tertiary"><Info className="h-3.5 w-3.5" /> {coverage.formula}</p>
              </div>
              <div className="text-right text-[13px] text-ink-secondary">
                <div>{coverage.resolvedCount} live answers</div>
                <div>{coverage.openUnanswered} open gaps</div>
              </div>
            </div>
          </Card>

          {totalQuestions === 0 ? (
            <EmptyState icon={BookOpen} title="No answered-question data yet" hint="Once the AI starts answering guests, daily quality aggregates (answer rate, handoff rate, latency) will appear here — each with its formula. Coverage and content health above are already live." />
          ) : (
            <>
              <div className="mb-3 text-[12px] text-ink-tertiary">From {totalQuestions} logged questions over the {rows.length}-day window.</div>
              <div className="grid gap-4 sm:grid-cols-2">
                {metrics.map((m) => (
                  <Card key={m.key} className="p-5">
                    <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">{m.label}</div>
                    <div className="mt-2 font-display text-[28px] leading-none tabular-nums text-ink-primary">{fmt(m)}</div>
                    <p className="mt-2 flex items-start gap-1.5 text-[12px] text-ink-tertiary"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span><span className="font-mono text-ink-secondary">{m.formula}</span> · {m.window}</span></p>
                  </Card>
                ))}
              </div>
            </>
          )}

          {/* Content health — documented derivations */}
          <div className="mt-6">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Content health</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <HealthTile label="Published articles" value={health.publishedCount} note="status = published" />
              <HealthTile label="Drafts" value={health.draftCount} note="status = draft" />
              <HealthTile label="Missing approved answer" value={health.missingApprovedAnswer} note="available_to_ai AND approved_answer is empty" tone={health.missingApprovedAnswer ? "warning" : undefined} />
              <HealthTile label="Critical, unpublished" value={health.criticalPending} note="is_critical AND status ≠ published" tone={health.criticalPending ? "danger" : undefined} />
              <HealthTile label="Expired critical" value={health.expiredCritical} note="is_critical AND valid_to < now" tone={health.expiredCritical ? "danger" : undefined} />
              <HealthTile label="Open unanswered" value={health.unresolvedUnanswered} note="unanswered_questions where status = open" tone={health.unresolvedUnanswered ? "warning" : undefined} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function HealthTile({ label, value, note, tone }: { label: string; value: number; note: string; tone?: "warning" | "danger" }) {
  const color = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-ink-primary";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        {tone && <AlertTriangle className={`h-3.5 w-3.5 ${color}`} />}
        <div className={`font-display text-[24px] leading-none tabular-nums ${color}`}>{value}</div>
      </div>
      <div className="mt-1.5 text-[13px] text-ink-secondary">{label}</div>
      <div className="mt-0.5 font-mono text-[11px] text-ink-tertiary">{note}</div>
    </Card>
  );
}
