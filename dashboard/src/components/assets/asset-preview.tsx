"use client";

import * as React from "react";
import { FileText, FileAudio, Video, ImageIcon, Shapes, PenLine, Lock, Eye, ExternalLink, RotateCw } from "lucide-react";
import { assetKind } from "@/data/asset-constants";
import { publicUrl, transformedUrl } from "@/data/storage";
import { useSignedPreview } from "@/data/consent-files";
import { humanizeError } from "@/data/errors";
import type { AssetSummary, AssetDetail } from "@/data/asset-types";
import { cn } from "@/lib/utils";
import type { TransformPreset } from "@/data/asset-constants";

const KIND_ICON = { image: ImageIcon, video: Video, audio: FileAudio, document: FileText, logo: ImageIcon, icon: Shapes, consent: PenLine, other: FileText } as const;

function KindIcon({ asset, className }: { asset: AssetSummary; className?: string }) {
  const Icon = KIND_ICON[assetKind(asset.assetType)];
  return <Icon className={className} />;
}

/** Small thumbnail for lists/cards. Public images render; private/other show an icon. */
export function AssetThumb({ asset, preset = "card", className }: { asset: AssetSummary; preset?: TransformPreset; className?: string }) {
  const url = !asset.isPrivate && (asset.mimeType?.startsWith("image/")) ? transformedUrl(asset, preset) : null;
  return (
    <div className={cn("grid place-items-center overflow-hidden rounded-md bg-surface-sunken", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={asset.hasAltText ? "" : ""} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="relative text-ink-tertiary">
          <KindIcon asset={asset} className="h-6 w-6" />
          {asset.isPrivate && <Lock className="absolute -right-2 -top-1 h-3 w-3 text-warning" />}
        </span>
      )}
    </div>
  );
}

/** Large preview for the detail screen. Public images/audio render inline;
 *  private files require an authorized, expiring signed URL fetched on demand. */
export function AssetPreview({ asset }: { asset: AssetDetail }) {
  if (asset.isExternal) {
    return (
      <div className="grid place-items-center rounded-lg border border-border-subtle bg-surface-sunken p-10 text-center">
        <Video className="h-10 w-10 text-ink-tertiary" />
        <p className="mt-3 text-[13px] text-ink-secondary capitalize">{asset.externalProvider} video</p>
        {asset.externalUrl && <a href={asset.externalUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12px] text-info hover:underline">Open source <ExternalLink className="h-3.5 w-3.5" /></a>}
      </div>
    );
  }

  if (asset.isPrivate) return <PrivatePreview asset={asset} />;

  const isImage = asset.mimeType?.startsWith("image/");
  const isAudio = asset.mimeType?.startsWith("audio/");
  if (isImage) {
    const url = transformedUrl(asset, "full") ?? publicUrl(asset);
    return (
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-sunken">
        {url ? <img src={url} alt={asset.altText ?? ""} className="max-h-[420px] w-full object-contain" /> : <div className="grid h-56 place-items-center text-ink-tertiary">No preview</div>}
      </div>
    );
  }
  if (isAudio) {
    const url = publicUrl(asset);
    return (
      <div className="rounded-lg border border-border-subtle bg-surface-sunken p-6">
        <div className="mb-3 flex items-center gap-2 text-[13px] text-ink-secondary"><FileAudio className="h-5 w-5 text-ink-tertiary" /> Audio {asset.durationSeconds ? `· ${asset.durationSeconds}s` : ""}</div>
        {url && <audio controls src={url} className="w-full" />}
      </div>
    );
  }
  return (
    <div className="grid place-items-center rounded-lg border border-border-subtle bg-surface-sunken p-10 text-center text-ink-tertiary">
      <KindIcon asset={asset} className="h-10 w-10" />
      <p className="mt-2 text-[13px]">{asset.mimeType ?? "File"}</p>
    </div>
  );
}

function PrivatePreview({ asset }: { asset: AssetDetail }) {
  const [reveal, setReveal] = React.useState(false);
  const q = useSignedPreview(asset.id, reveal);
  const isImage = asset.mimeType?.startsWith("image/");

  return (
    <div className="rounded-lg border border-warning/30 bg-warning-soft/10 p-5">
      <div className="mb-3 flex items-center gap-2 text-[12px] font-medium text-warning"><Lock className="h-4 w-4" /> Private file — authorized access only</div>
      {!reveal ? (
        <button onClick={() => setReveal(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[13px] font-semibold text-brand-navy hover:bg-brand-creamSoft"><Eye className="h-4 w-4" /> Request preview</button>
      ) : q.isLoading ? (
        <div className="flex items-center gap-2 text-[13px] text-ink-tertiary"><RotateCw className="h-4 w-4 animate-spin" /> Getting a secure link…</div>
      ) : q.isError ? (
        <p className="text-[13px] text-danger">{humanizeError(q.error)}</p>
      ) : q.data ? (
        <div>
          {isImage ? (
            <img src={q.data.url} alt="" className="max-h-[360px] rounded-md border border-border-subtle bg-white object-contain" />
          ) : (
            <a href={q.data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-info hover:underline">Open file (expiring link) <ExternalLink className="h-3.5 w-3.5" /></a>
          )}
          <p className="mt-2 text-[11px] text-ink-tertiary">Link expires in ~{q.data.expiresIn}s. <button onClick={() => q.refetch()} className="underline hover:text-ink-secondary">Refresh</button></p>
        </div>
      ) : (
        <p className="text-[13px] text-ink-tertiary">No preview available.</p>
      )}
    </div>
  );
}
