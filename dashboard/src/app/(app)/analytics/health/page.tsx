"use client";

import * as React from "react";
import Link from "next/link";
import { HeartPulse, ShieldCheck, AlertTriangle, CircleAlert, MinusCircle, RefreshCw, Check } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useHotelHealth, type HealthDimension, type HealthStatus } from "@/data/hotel-health";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { humanizeError } from "@/data/errors";
import { AnalyticsShell } from "@/components/analytics/analytics-shell";
import { SectionLoader, ErrorState } from "@/components/content/states";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const META: Record<HealthStatus, { label: string; icon: typeof ShieldCheck; cls: string; badge: string }> = {
  healthy: { label: "Healthy", icon: ShieldCheck, cls: "text-success", badge: "border-success/30 bg-success-soft/20 text-success" },
  attention: { label: "Needs attention", icon: AlertTriangle, cls: "text-warning", badge: "border-warning/30 bg-warning-soft/20 text-warning" },
  critical: { label: "Critical", icon: CircleAlert, cls: "text-danger", badge: "border-danger/30 bg-danger-soft/20 text-danger" },
  unavailable: { label: "Not available", icon: MinusCircle, cls: "text-ink-tertiary", badge: "border-border-subtle text-ink-tertiary" },
};

export default function HotelHealthPage() {
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const q = useHotelHealth(currentHotel?.id);
  const [refreshing, setRefreshing] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const canRefresh = role === "platform_admin" || role === "hotel_admin";

  const refresh = async () => {
    if (!currentHotel?.id) return;
    setRefreshing(true); setMsg(null);
    try {
      const { error } = await getSupabaseBrowserClient().rpc("refresh_analytics", { p_hotel: currentHotel.id, p_day: new Date().toISOString().slice(0, 10) });
      if (error) throw error;
      setMsg("Analytics refreshed for today.");
      q.refetch();
    } catch (e) { setMsg(humanizeError(e)); } finally { setRefreshing(false); }
  };

  return (
    <AnalyticsShell title="Hotel Health" subtitle="A summary of independent, explainable dimensions — not one opaque score.">
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading || !q.data ? <SectionLoader rows={5} />
        : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {(() => { const M = META[q.data!.overall]; const I = M.icon; return <><span className={`flex h-11 w-11 items-center justify-center rounded-xl ${M.badge}`}><I className="h-5 w-5" /></span><div><div className="font-display text-[20px] text-ink-primary">{M.label}</div><div className="text-[12px] text-ink-tertiary">Overall = worst dimension you can see · <span className="font-mono">{q.data!.formulaVersion}</span></div></div></>; })()}
            </div>
            {canRefresh && (
              <div className="flex items-center gap-2">
                {msg && <span className="text-[11px] text-ink-tertiary">{msg}</span>}
                <Button variant="secondary" size="sm" onClick={refresh} loading={refreshing}><RefreshCw className="h-4 w-4" /> Refresh analytics <span className="ml-1 rounded bg-surface-overlay px-1 text-[10px] text-ink-tertiary">dev</span></Button>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {q.data!.dimensions.map((d) => <Dimension key={d.key} d={d} />)}
          </div>

          <p className="text-[11px] text-ink-tertiary">Each dimension is computed live and links to the fix. “Refresh analytics” recomputes today’s aggregate rows server-side (SECURITY DEFINER, hotel-scoped) — a scheduled refresh (Render cron or Supabase scheduled job) is the recommended production model; no production cron is configured here.</p>
        </div>
      )}
    </AnalyticsShell>
  );
}

function Dimension({ d }: { d: HealthDimension }) {
  const M = META[d.status]; const I = M.icon;
  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-ink-primary">{d.label}</span>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${M.badge}`}><I className="h-3 w-3" /> {M.label}</span>
      </div>
      <p className={`text-[13px] ${d.status === "healthy" ? "text-ink-secondary" : M.cls}`}>{d.headline}</p>
      {d.reasons.length > 0 && (
        <ul className="mt-2 space-y-1">
          {d.reasons.map((r, i) => <li key={i} className="text-[12px]">{r.href ? <Link href={r.href} className="text-ink-tertiary hover:text-ink-secondary hover:underline">{r.text} →</Link> : <span className="text-ink-tertiary">{r.text}</span>}</li>)}
        </ul>
      )}
    </Card>
  );
}
