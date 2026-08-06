"use client";

import * as React from "react";
import Link from "next/link";
import { Images, Plus, Search, AlertTriangle, Film, Music, Image as ImageIcon, Link2, Globe, Building2 } from "lucide-react";
import { usePlatformMedia, usePlatformMediaSummary, type MediaCard } from "@/data/platform-media";
import { assetKind, humanBytes, ASSET_TYPE_LABEL } from "@/data/asset-constants";
import { publicUrl } from "@/data/storage";
import { usePlatform } from "@/providers/platform-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const SELECT_CLS = "appearance-none rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-1.5 text-[13px] text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2";
type KindFilter = "all" | "image" | "video" | "audio" | "logo" | "icon";

function KindIcon({ a }: { a: MediaCard }) {
  const k = assetKind(a.assetType);
  if (k === "video") return <Film className="h-5 w-5 text-ink-tertiary" />;
  if (k === "audio") return <Music className="h-5 w-5 text-ink-tertiary" />;
  return <ImageIcon className="h-5 w-5 text-ink-tertiary" />;
}

function Thumb({ a }: { a: MediaCard }) {
  const url = publicUrl({ bucketName: a.bucketName, storagePath: a.storagePath, publicAccess: a.publicAccess });
  const isImg = ["image", "logo", "icon"].includes(assetKind(a.assetType)) && !!url;
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-xl bg-surface-sunken">
      {isImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url!} alt={a.hasAltText ? "" : a.displayName} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="grid h-full w-full place-items-center"><KindIcon a={a} /></div>
      )}
      {a.isExternal && <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-brand-navy/70 px-1.5 py-0.5 text-[10px] font-medium text-brand-cream"><Link2 className="h-3 w-3" />{a.externalProvider}</span>}
      {a.status === "archived" && <span className="absolute right-1.5 top-1.5 rounded bg-ink-tertiary/80 px-1.5 py-0.5 text-[10px] font-medium text-surface-base">Archived</span>}
    </div>
  );
}

export default function PlatformMediaPage() {
  const { destinations } = usePlatform();
  const [search, setSearch] = React.useState("");
  const [kind, setKind] = React.useState<KindFilter>("all");
  const [scope, setScope] = React.useState<"all" | "platform" | string>("all"); // "all" | "platform" | destinationId
  const [includeArchived, setIncludeArchived] = React.useState(false);

  const destFilter = scope !== "all" && scope !== "platform" ? scope : null;
  const { data: rows, isLoading, isError, error, refetch } = usePlatformMedia(destFilter, { includeArchived });
  const { data: summary } = usePlatformMediaSummary(destFilter);
  const destName = React.useMemo(() => new Map(destinations.map((d) => [d.id, d.name])), [destinations]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((a) => {
      if (scope === "platform" && a.scope !== "platform") return false;
      if (kind !== "all" && assetKind(a.assetType) !== kind) return false;
      if (q && !`${a.displayName} ${a.originalFilename ?? ""} ${ASSET_TYPE_LABEL[a.assetType]}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, kind, scope]);

  const activeFilters = kind !== "all" || scope !== "all" || includeArchived || !!search.trim();

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Media library</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-tertiary">Platform- and destination-owned public media. Hotels reference this shared media; they never edit the canonical files or their rights. Private guest files (signatures, consent PDFs) live in each hotel’s own Asset Manager and never appear here.</p>
        </div>
        <Button asChild variant="primary" size="sm"><Link href="/platform/media/upload"><Plus className="h-4 w-4" /> Add media</Link></Button>
      </header>

      {summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Total media", value: summary.total, hint: humanBytes(summary.storageBytes) },
            { label: "Destination-owned", value: summary.destinationOwned, hint: `${summary.platformOwned} platform-wide` },
            { label: "Missing alt / rights", value: `${summary.missingAlt} / ${summary.missingRights}`, hint: "accessibility & licensing" },
            { label: "Unused", value: summary.unused, hint: `${summary.archived} archived` },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border-subtle bg-surface-raised px-3.5 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{s.label}</div>
              <div className="mt-1 text-lg font-semibold text-ink-primary">{s.value}</div>
              <div className="text-[11px] text-ink-tertiary">{s.hint}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, filename, type…" className="pl-8" aria-label="Search media" />
        </div>
        <select aria-label="Scope" className={SELECT_CLS} value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">All scopes</option>
          <option value="platform">Platform-wide</option>
          {destinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select aria-label="Kind" className={SELECT_CLS} value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
          <option value="all">All kinds</option><option value="image">Images</option><option value="video">Video</option><option value="audio">Audio</option><option value="logo">Logos</option><option value="icon">Icons</option>
        </select>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-secondary"><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="h-3.5 w-3.5 rounded border-border-strong" /> Include archived</label>
      </div>

      {isError ? (
        <div className="rounded-xl border border-danger/30 bg-danger-soft/40 p-6 text-center"><AlertTriangle className="mx-auto h-6 w-6 text-danger" /><p className="mt-2 text-sm text-ink-secondary">Couldn’t load media. {(error as any)?.message}</p><Button variant="secondary" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button></div>
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[200px] w-full rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-10 text-center"><Images className="mx-auto h-7 w-7 text-ink-tertiary" /><p className="mt-3 text-sm font-medium text-ink-secondary">{activeFilters ? "No media matches these filters." : "No platform media yet."}</p>{!activeFilters && <Button asChild variant="primary" size="sm" className="mt-4"><Link href="/platform/media/upload"><Plus className="h-4 w-4" /> Add the first media</Link></Button>}</div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((a) => (
            <li key={a.id}>
              <Link href={`/platform/media/${a.id}`} className="group block overflow-hidden rounded-xl border border-border-subtle bg-surface-raised transition hover:border-brand-goldDeep/50 hover:shadow-sm">
                <Thumb a={a} />
                <div className="space-y-1 p-3">
                  <div className="truncate text-[13px] font-medium text-ink-primary">{a.displayName}</div>
                  <div className="flex items-center justify-between text-[11px] text-ink-tertiary">
                    <span className="inline-flex items-center gap-1">{a.scope === "destination" ? <><Building2 className="h-3 w-3" /> {(a.destinationId && destName.get(a.destinationId)) ?? "Destination"}</> : <><Globe className="h-3 w-3" /> Platform</>}</span>
                    <span>{a.isExternal ? "external" : humanBytes(a.fileSizeBytes)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-ink-tertiary">{ASSET_TYPE_LABEL[a.assetType]}</span>
                    <span className={a.usageCount ? "text-ink-secondary" : "text-ink-tertiary"}>{a.usageCount ? `${a.usageCount} use${a.usageCount > 1 ? "s" : ""}` : "unused"}</span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
