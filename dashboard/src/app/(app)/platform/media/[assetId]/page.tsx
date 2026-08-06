"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Save, Archive, ArchiveRestore, Copy, Check, RefreshCw, AlertTriangle, Globe, Building2 } from "lucide-react";
import { usePermissions } from "@/providers/permission-provider";
import { usePlatform } from "@/providers/platform-provider";
import { usePlatformAsset, useUpdatePlatformAsset, useArchivePlatformAsset, useRestorePlatformAsset } from "@/data/platform-media";
import { publicUrl, transformedUrl } from "@/data/storage";
import { humanizeError } from "@/data/errors";
import { assetKind, humanBytes, ASSET_TYPE_LABEL, TRANSFORM_PRESETS, type TransformPreset } from "@/data/asset-constants";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, PermissionDenied } from "@/components/content/states";
import { AssetPreview } from "@/components/assets/asset-preview";
import { ScopeBadge, StatusBadge } from "@/components/assets/asset-pills";
import { UsagePanel } from "@/components/assets/usage-panel";
import { TextField, TextAreaField } from "@/components/content/fields";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { AssetDetail } from "@/data/asset-types";

export default function PlatformMediaDetailPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const { isPlatformAdmin } = usePermissions();
  const { destinations } = usePlatform();
  const q = usePlatformAsset(assetId);
  const update = useUpdatePlatformAsset();
  const archive = useArchivePlatformAsset();
  const restore = useRestorePlatformAsset();

  const [form, setForm] = React.useState<Partial<AssetDetail>>({});
  const [dirty, setDirty] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  React.useEffect(() => { if (q.data) { setForm(q.data); setDirty(false); } }, [q.data?.id, q.data?.updatedAt]);

  if (q.isError) return <div className="mx-auto max-w-[1100px] p-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  if (q.isLoading || !q.data) return <div className="mx-auto max-w-[1100px] p-6"><SectionLoader rows={6} /></div>;
  const a = q.data;

  const mayEdit = isPlatformAdmin;
  const set = <K extends keyof AssetDetail>(k: K, v: AssetDetail[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const destName = a.destinationId ? destinations.find((d) => d.id === a.destinationId)?.name ?? "Destination" : null;

  const save = async () => {
    setErr(null);
    try {
      await update.mutateAsync({ id: a.id, patch: { displayName: form.displayName, altText: form.altText ?? null, caption: form.caption ?? null, sourceCredit: form.sourceCredit ?? null, rightsOwner: form.rightsOwner ?? null, rightsNotes: form.rightsNotes ?? null, licenseType: form.licenseType ?? null, externalUrl: form.externalUrl ?? null, externalId: form.externalId ?? null } });
      setDirty(false);
    } catch (e) { setErr(humanizeError(e)); }
  };
  const doArchive = async () => { setErr(null); try { await archive.mutateAsync(a.id); setArchiveOpen(false); } catch (e) { setErr(humanizeError(e)); setArchiveOpen(false); } };
  const copy = (key: string, value: string | null) => { if (value) { navigator.clipboard.writeText(value); setCopied(key); setTimeout(() => setCopied(null), 1500); } };

  const url = publicUrl(a);
  const isImageLike = ["image", "logo", "icon"].includes(assetKind(a.assetType));
  const showTransforms = isImageLike && !!url;
  const presets: TransformPreset[] = ["thumb", "card", "hero", "full"];

  return (
    <div className="mx-auto max-w-[1100px] p-6">
      <PageHeader
        crumbs={[{ label: "Media", href: "/platform/media" }, { label: a.displayName }]}
        title={<span className="flex items-center gap-3">{form.displayName || a.displayName} <StatusBadge status={a.status} /></span>}
        subtitle={<span className="flex items-center gap-2"><ScopeBadge scope={a.scope} /> {ASSET_TYPE_LABEL[a.assetType]}{a.mimeType ? ` · ${a.mimeType}` : ""}</span>}
        backHref="/platform/media"
        actions={
          <div className="flex items-center gap-2">
            {url && <Button variant="ghost" onClick={() => copy("url", url)}>{copied === "url" ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />} {copied === "url" ? "Copied" : "Copy URL"}</Button>}
            {mayEdit && <Link href="/platform/media/upload" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong px-3 text-[13px] font-medium text-ink-secondary hover:text-ink-primary"><RefreshCw className="h-4 w-4" /> Add new</Link>}
            {mayEdit && (a.status === "archived" ? (
              <Button variant="secondary" onClick={() => restore.mutateAsync(a.id)} loading={restore.isPending}><ArchiveRestore className="h-4 w-4" /> Restore</Button>
            ) : (
              <Button variant="ghost" onClick={() => setArchiveOpen(true)}><Archive className="h-4 w-4" /> Archive</Button>
            ))}
          </div>
        }
      />

      {err && <p className="mb-4 text-[12px] text-danger">{err}</p>}
      {!mayEdit && <div className="mb-4"><PermissionDenied message="Only platform admins manage canonical media. Hotels reference this media but never edit it." /></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left — preview + transforms + usage */}
        <div className="space-y-4">
          <AssetPreview asset={a} />

          {showTransforms && (
            <Card className="p-5">
              <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Transforms</div>
              <p className="mb-3 text-[12px] text-ink-tertiary">One original; Supabase renders each size on demand. Hotels request the preset they need — no physical copies are created.</p>
              <div className="space-y-1.5">
                {presets.map((p) => {
                  const turl = transformedUrl(a, p);
                  const t = TRANSFORM_PRESETS[p];
                  return (
                    <div key={p} className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-base px-3 py-2 text-[13px]">
                      <span className="w-14 font-medium capitalize text-ink-primary">{p}</span>
                      <span className="w-24 text-[11px] text-ink-tertiary">{t ? `${t.width}×${t.height}` : "original"}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-tertiary">{turl ?? "—"}</span>
                      <button onClick={() => copy(`t-${p}`, turl)} className="rounded p-1 text-ink-tertiary hover:text-brand-cream" title="Copy URL">{copied === `t-${p}` ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}</button>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card className="p-5"><UsagePanel assetId={a.id} hotelId={undefined} canManage={mayEdit} isPrivate={a.isPrivate} /></Card>
        </div>

        {/* Right — details + metadata */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Details</div>
            <dl className="space-y-2 text-[13px]">
              <Row label="Ownership">{a.scope === "destination" ? <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {destName}</span> : <span className="inline-flex items-center gap-1"><Globe className="h-3.5 w-3.5" /> Platform-wide</span>}</Row>
              <Row label="Filename">{a.originalFilename ?? (a.isExternal ? "external" : "—")}</Row>
              <Row label="Size">{a.isExternal ? "external" : humanBytes(a.fileSizeBytes)}</Row>
              {a.width ? <Row label="Dimensions">{a.width}×{a.height}</Row> : null}
              {a.durationSeconds ? <Row label="Duration">{a.durationSeconds}s</Row> : null}
              <Row label="Uses">{a.usageCount}</Row>
              <Row label="Created">{new Date(a.createdAt).toLocaleDateString()}</Row>
            </dl>
          </Card>

          <Card className="p-5">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Metadata</div>
            <div className="space-y-3">
              <TextField label="Display name" value={form.displayName ?? ""} onChange={(v) => set("displayName", v)} disabled={!mayEdit} />
              {isImageLike && <TextField label="Alt text" hint="accessibility & AI" value={form.altText ?? ""} onChange={(v) => set("altText", v)} disabled={!mayEdit} placeholder="Describe the image" />}
              <TextAreaField label="Caption" value={form.caption ?? ""} onChange={(v) => set("caption", v)} disabled={!mayEdit} rows={2} />
              {a.isExternal && <TextField label="External URL" value={form.externalUrl ?? ""} onChange={(v) => set("externalUrl", v)} disabled={!mayEdit} />}
              <TextField label="Source credit" value={form.sourceCredit ?? ""} onChange={(v) => set("sourceCredit", v)} disabled={!mayEdit} />
              <TextField label="Rights owner" value={form.rightsOwner ?? ""} onChange={(v) => set("rightsOwner", v)} disabled={!mayEdit} />
              <TextField label="License" value={form.licenseType ?? ""} onChange={(v) => set("licenseType", v)} disabled={!mayEdit} />
              <TextAreaField label="Rights notes" value={form.rightsNotes ?? ""} onChange={(v) => set("rightsNotes", v)} disabled={!mayEdit} rows={2} />
            </div>
            {mayEdit && <div className="mt-3 flex justify-end"><Button variant="secondary" size="sm" onClick={save} loading={update.isPending} disabled={!dirty}><Save className="h-4 w-4" /> Save</Button></div>}
          </Card>
        </div>
      </div>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Archive this media?</DialogTitle><DialogDescription>{a.usageCount > 0 ? `This media is referenced in ${a.usageCount} place${a.usageCount > 1 ? "s" : ""}. Detach those usages first — the database blocks archiving media still in use.` : "It will be hidden from the library but not deleted. You can restore it anytime."}</DialogDescription></DialogHeader>
          {a.usageCount > 0 && <p className="flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning-soft/40 px-3 py-2 text-[12px] text-warning"><AlertTriangle className="h-3.5 w-3.5" /> Remove {a.usageCount} usage{a.usageCount > 1 ? "s" : ""} before archiving.</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setArchiveOpen(false)}>Cancel</Button><Button variant="primary" onClick={doArchive} loading={archive.isPending} disabled={a.usageCount > 0}><Archive className="h-4 w-4" /> Archive</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><dt className="text-ink-tertiary">{label}</dt><dd className="min-w-0 truncate text-ink-primary">{children}</dd></div>;
}
