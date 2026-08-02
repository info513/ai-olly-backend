"use client";

import { Sparkles, BookOpen, ConciergeBell, FileText, Star } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useHomeSummary } from "@/hooks/use-dashboard";
import { Greeting } from "@/components/home/greeting";
import { KpiCard } from "@/components/home/kpi-card";
import { TodayCard } from "@/components/home/today-card";
import { RequestsCard } from "@/components/home/requests-card";
import { QuickActions } from "@/components/home/quick-actions";
import { RecentActivity } from "@/components/home/recent-activity";
import { Skeleton } from "@/components/ui/skeleton";

export default function HomePage() {
  const { currentHotel } = useHotel();
  const { data, isLoading } = useHomeSummary(currentHotel?.id);

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-6">
      <Greeting />

      {/* KPI row — meaning-first metrics (Design System §6, UX Bible §5) */}
      {isLoading || !data ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[132px]" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="AI answered confidently"
            value={data.aiCoveragePct}
            suffix="%"
            hint={`${data.aiHandoffPct}% handed off to reception`}
            icon={Sparkles}
            tone="success"
            href="/ai"
          />
          <KpiCard
            label="Knowledge completeness"
            value={data.knowledgeCompletenessPct}
            suffix="%"
            hint="1 critical item expiring"
            icon={BookOpen}
            tone="warning"
            href="/ai"
          />
          <KpiCard
            label="Open requests"
            value={data.openRequests.length}
            hint={`${data.openRequests.filter((r) => r.priority === "urgent").length} urgent`}
            icon={ConciergeBell}
            tone={data.openRequests.some((r) => r.priority === "urgent") ? "danger" : "neutral"}
            href="/reception"
          />
          <KpiCard
            label="Drafts waiting"
            value={data.draftsWaiting}
            hint={`Feedback avg ${data.feedbackAverage.toFixed(1)}★`}
            icon={FileText}
            tone="info"
            href="/content"
          />
        </div>
      )}

      {/* Operational body */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {isLoading || !data ? (
            <>
              <div className="grid gap-6 sm:grid-cols-2">
                <Skeleton className="h-64" />
                <Skeleton className="h-64" />
              </div>
              <Skeleton className="h-56" />
            </>
          ) : (
            <>
              <div className="grid gap-6 sm:grid-cols-2">
                <TodayCard kind="arrivals" items={data.arrivals} />
                <TodayCard kind="departures" items={data.departures} />
              </div>
              <RequestsCard items={data.openRequests} />
            </>
          )}
        </div>

        <div className="space-y-6">
          <QuickActions />
          {isLoading || !data ? (
            <Skeleton className="h-72" />
          ) : (
            <RecentActivity items={data.recentActivity} />
          )}
        </div>
      </div>

      <p className="flex items-center justify-center gap-1.5 pt-2 text-[11px] text-ink-tertiary">
        <Star className="h-3 w-3" /> Sprint 1 preview — all figures are placeholder data. No backend is connected yet.
      </p>
    </div>
  );
}
