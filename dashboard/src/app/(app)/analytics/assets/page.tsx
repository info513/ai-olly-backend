"use client";

import { useHotel } from "@/providers/hotel-provider";
import { useAssets } from "@/data/assets";
import { assetKind, humanBytes, ASSET_TYPE_LABEL } from "@/data/asset-constants";
import { AnalyticsShell } from "@/components/analytics/analytics-shell";
import { MetricTile, BarList } from "@/components/analytics/charts";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { Card } from "@/components/ui/card";
import { Images } from "lucide-react";

export default function AssetAnalytics() {
  const { currentHotel } = useHotel();
  const q = useAssets(currentHotel?.id, { includeArchived: true });

  return (
    <AnalyticsShell title="Asset analytics" subtitle="Media library health and reuse.">
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <SectionLoader rows={4} />
        : (q.data ?? []).length === 0 ? <EmptyState icon={Images} title="No assets" hint="Upload assets to populate analytics." />
        : <Body assets={q.data!} />}
    </AnalyticsShell>
  );
}

function Body({ assets }: { assets: any[] }) {
  const live = assets.filter((a) => a.status !== "archived");
  const isImg = (a: any) => ["image", "logo", "icon"].includes(assetKind(a.assetType));
  const byType = Object.entries(live.reduce((m: Record<string, number>, a) => { m[a.assetType] = (m[a.assetType] ?? 0) + 1; return m; }, {})).map(([k, v]) => ({ label: ASSET_TYPE_LABEL[k as keyof typeof ASSET_TYPE_LABEL] ?? k, value: v as number })).sort((a, b) => b.value - a.value).slice(0, 8);
  const topReused = [...live].filter((a) => a.usageCount > 0).sort((a, b) => b.usageCount - a.usageCount).slice(0, 6).map((a) => ({ label: a.displayName, value: a.usageCount }));
  const storage = live.reduce((n, a) => n + (a.fileSizeBytes ?? 0), 0);

  const stat = {
    total: live.length,
    publicCount: live.filter((a) => a.publicAccess).length,
    privateCount: live.filter((a) => a.isPrivate).length,
    unused: live.filter((a) => a.usageCount === 0 && !a.isPrivate).length,
    missingAlt: live.filter((a) => isImg(a) && !a.hasAltText).length,
    missingRights: live.filter((a) => !a.isPrivate && !a.hasRights).length,
    archived: assets.filter((a) => a.status === "archived").length,
    consentFiles: live.filter((a) => a.isPrivate).length,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <MetricTile label="Total assets" value={stat.total} formula="not archived" />
        <MetricTile label="Public / private" value={`${stat.publicCount} / ${stat.privateCount}`} formula="public_access split" />
        <MetricTile label="Unused" value={stat.unused} formula="0 usages, non-private" href="/assets/usage?filter=unused" tone={stat.unused ? "warning" : "neutral"} />
        <MetricTile label="Missing alt" value={stat.missingAlt} formula="image-like, no alt_text" href="/assets/images?filter=missing-alt" tone={stat.missingAlt ? "warning" : "neutral"} />
        <MetricTile label="Missing rights" value={stat.missingRights} formula="non-private, no rights_owner" href="/assets?filter=missing-rights" tone={stat.missingRights ? "warning" : "neutral"} />
        <MetricTile label="Archived" value={stat.archived} formula="status = archived" href="/assets/archived" />
        <MetricTile label="Storage" value={humanBytes(storage)} formula="Σ file_size_bytes" />
        <MetricTile label="Consent files" value={stat.consentFiles} formula="private consent assets" href="/assets/documents" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5"><div className="mb-3 text-[12px] font-medium text-ink-secondary">Assets by type</div>{byType.length ? <BarList items={byType} /> : <p className="text-[13px] text-ink-tertiary">No data.</p>}</Card>
        <Card className="p-5"><div className="mb-3 text-[12px] font-medium text-ink-secondary">Top reused assets</div>{topReused.length ? <BarList items={topReused} /> : <p className="text-[13px] text-ink-tertiary">No reused assets yet.</p>}</Card>
      </div>
    </div>
  );
}
