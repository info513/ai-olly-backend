"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search, Images, X, Plus } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useAssets } from "@/data/assets";
import { assetKind, humanBytes } from "@/data/asset-constants";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { AssetThumb } from "./asset-preview";
import { ScopeBadge, PrivateBadge, MissingAltChip, MissingRightsChip, UnusedChip, ArchivedChip } from "./asset-pills";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AssetSummary } from "@/data/asset-types";

export type AssetView = "all" | "images" | "videos" | "documents" | "audio" | "logos" | "icons" | "newsletter" | "consent" | "archived";
const VIEWS: [AssetView, string][] = [
  ["all", "All"], ["images", "Images"], ["videos", "Videos"], ["documents", "Documents"], ["audio", "Audio"],
  ["logos", "Logos"], ["icons", "Icons"], ["newsletter", "Newsletter"], ["consent", "Consent files"], ["archived", "Archived"],
];

const inView = (a: AssetSummary, v: AssetView): boolean => {
  const k = assetKind(a.assetType);
  switch (v) {
    case "all": return true;
    case "images": return k === "image";
    case "videos": return k === "video";
    case "documents": return k === "document";
    case "audio": return k === "audio";
    case "logos": return a.assetType === "logo";
    case "icons": return a.assetType === "icon";
    case "newsletter": return a.assetType === "newsletter_asset" || a.assetType === "news_image";
    case "consent": return a.isPrivate;
    case "archived": return true;
  }
};

export function AssetLibrary({ view: fixedView, showTabs = true }: { view?: AssetView; showTabs?: boolean }) {
  const { currentHotel } = useHotel();
  const params = useSearchParams();
  const [view, setView] = React.useState<AssetView>(fixedView ?? "all");
  const [search, setSearch] = React.useState("");
  const [special, setSpecial] = React.useState(params.get("filter") ?? "all"); // all | unused | missing-alt | missing-rights
  const q = useAssets(currentHotel?.id, { includeArchived: (fixedView ?? view) === "archived" });

  const effView = fixedView ?? view;

  const items = React.useMemo(() => {
    let list = q.data ?? [];
    if (effView === "archived") list = list.filter((a) => a.status === "archived");
    else list = list.filter((a) => a.status !== "archived" && inView(a, effView));
    if (special === "unused") list = list.filter((a) => a.usageCount === 0 && !a.isPrivate);
    if (special === "missing-alt") list = list.filter((a) => ["image", "logo", "icon"].includes(assetKind(a.assetType)) && !a.hasAltText);
    if (special === "missing-rights") list = list.filter((a) => !a.isPrivate && !a.hasRights);
    if (search.trim()) { const t = search.toLowerCase(); list = list.filter((a) => a.displayName.toLowerCase().includes(t) || (a.originalFilename ?? "").toLowerCase().includes(t)); }
    return list;
  }, [q.data, effView, special, search]);

  return (
    <div>
      {showTabs && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {VIEWS.map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} className={cn("rounded-full border px-3 py-1 text-[12px] transition-colors", view === v ? "border-brand-goldDeep/50 bg-surface-base text-ink-primary" : "border-border-subtle text-ink-tertiary hover:text-ink-secondary")}>{label}</button>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or filename…" className="h-8 w-60 pl-8" /></div>
        <select value={special} onChange={(e) => setSpecial(e.target.value)} className="h-8 rounded-md border border-border-strong bg-surface-sunken px-2 text-[12px] text-ink-secondary focus-visible:border-brand-goldDeep focus-visible:outline-none">
          <option value="all">Any</option><option value="unused">Unused</option><option value="missing-alt">Missing alt</option><option value="missing-rights">Missing rights</option>
        </select>
        {(special !== "all" || search) && <button onClick={() => { setSpecial("all"); setSearch(""); }} className="flex items-center gap-1 text-[12px] text-ink-tertiary hover:text-ink-secondary"><X className="h-3.5 w-3.5" /> Clear</button>}
      </div>

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <SectionLoader rows={4} />
        : items.length === 0 ? <EmptyState icon={Images} title={(q.data ?? []).length ? "No assets in this view" : "No assets yet"} hint={(q.data ?? []).length ? "Try another view or clear filters." : "Upload your first asset."} action={!(q.data ?? []).length && <Link href="/assets/upload" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[13px] font-semibold text-brand-navy"><Plus className="h-4 w-4" /> Upload</Link>} />
        : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{items.map((a) => <AssetCard key={a.id} a={a} />)}</div>}
    </div>
  );
}

function AssetCard({ a }: { a: AssetSummary }) {
  return (
    <Link href={`/assets/${a.id}`} className="group">
      <Card className="overflow-hidden p-0 transition-colors hover:border-border-strong">
        <AssetThumb asset={a} className="aspect-[4/3] w-full" />
        <div className="p-3">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-primary">{a.displayName}</span>
            {a.isPrivate && <PrivateBadge />}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-tertiary">
            <span>{a.isExternal ? (a.externalProvider ?? "external") : humanBytes(a.fileSizeBytes)}</span>
            <span>·</span>
            <span>{a.usageCount > 0 ? `${a.usageCount} use${a.usageCount > 1 ? "s" : ""}` : "unused"}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <ScopeBadge scope={a.scope} />
            {a.status === "archived" && <ArchivedChip />}
            {["image", "logo", "icon"].includes(assetKind(a.assetType)) && !a.hasAltText && <MissingAltChip />}
            {!a.isPrivate && !a.hasRights && <MissingRightsChip />}
            {a.usageCount === 0 && !a.isPrivate && a.status !== "archived" && <UnusedChip />}
          </div>
        </div>
      </Card>
    </Link>
  );
}
