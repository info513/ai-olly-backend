"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Save, Archive, ArchiveRestore, Copy, Check, RefreshCw, AlertTriangle } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useAsset, useUpdateAsset, useArchiveAsset, useRestoreAsset } from "@/data/assets";
import { publicUrl } from "@/data/storage";
import { humanizeError } from "@/data/errors";
import { assetKind, humanBytes, ASSET_TYPE_LABEL, isPrivateType } from "@/data/asset-constants";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, PermissionDenied } from "@/components/content/states";
import { AssetPreview } from "@/components/assets/asset-preview";
import { ScopeBadge, StatusBadge, PrivateBadge } from "@/components/assets/asset-pills";
import { UsagePanel } from "@/components/assets/usage-panel";
import { TextField, TextAreaField } from "@/components/content/fields";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { AssetDetail } from "@/data/asset-types";

export default function AssetDetailPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const { currentHotel } = useHotel();
  const { role, isPlatformAdmin } = usePermissions();
  const q = useAsset(assetId);
  const update = useUpdateAsset(currentHotel?.id);
  const archive = useArchiveAsset(currentHotel?.id);
  const restore = useRestoreAsset(currentHotel?.id);

  const [form, setForm] = React.useState<Partial<AssetDetail>>({});
  const [dirty, setDirty] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  React.useEffect(() => { if (q.data) { setForm(q.data); setDirty(false); } }, [q.data]);

  if (q.isError) return <div className="mx-auto max-w-[1100px] p-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  if (q.isLoading || !q.data) return <div className="mx-auto max-w-[1100px] p-6"><SectionLoader rows={6} /></div>;
  const a = q.data;

  const isHotelOwned = a.hotelId === currentHotel?.id;
  const priv = isPrivateType(a.assetType);
  const mayEdit = isPlatformAdmin
    || (isHotelOwned && (priv ? (role === "hotel_admin" || role === "reception") : (role === "hotel_admin" || role === "editor" || role === "marketing")));
  const set = <K extends keyof AssetDetail>(k: K, v: AssetDetail[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };

  const save = async () => {
    setErr(null);
    try { await update.mutateAsync({ id: a.id, patch: { displayName: form.displayName, altText: form.altText ?? null, caption: form.caption ?? null, sourceCredit: form.sourceCredit ?? null, rightsOwner: form.rightsOwner ?? null, rightsNotes: form.rightsNotes ?? null, licenseType: form.licenseType ?? null } }); setDirty(false); }
    catch (e) { setErr(humanizeError(e)); }
  };
  const doArchive = async () => { setErr(null); try { await archive.mutateAsync(a.id); setArchiveOpen(false); } catch (e) { setErr(humanizeError(e)); setArchiveOpen(false); } };
  const copyUrl = () => { const u = publicUrl(a); if (u) { navigator.clipboard.writeText(u); setCopied(true); setTimeout(() => setCopied(false), 1500); } };

  const url = publicUrl(a);
  const isImageLike = ["image", "logo", "icon"].includes(assetKind(a.assetType));

  return (
    <div className="mx-auto max-w-[1100px] p-6">
      <PageHeader
        crumbs={[{ label: "Photos & Media", href: "/assets" }, { label: a.displayName }]}
        title={<span className="flex items-center gap-3">{form.displayName || a.displayName} <StatusBadge status={a.status} />{a.isPrivate && <PrivateBadge />}</span>}
        subtitle={<span className="flex items-center gap-2"><ScopeBadge scope={a.scope} /> {ASSET_TYPE_LABEL[a.assetType]}{a.mimeType ? ` · ${a.mimeType}` : ""}</span>}
        backHref="/assets"
        actions={
          <div className="flex items-center gap-2">
            {url && <Button variant="ghost" onClick={copyUrl}>{copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy URL"}</Button>}
            {mayEdit && <Link href="/assets/upload" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong px-3 text-[13px] font-medium text-ink-secondary hover:text-ink-primary"><RefreshCw className="h-4 w-4" /> Replace</Link>}
            {mayEdit && (a.status === "archived" ? (
              <Button variant="secondary" onClick={() => restore.mutateAsync(a.id)} loading={restore.isPending}><ArchiveRestore className="h-4 w-4" /> Restore</Button>
            ) : (
              <Button variant="ghost" onClick={() => setArchiveOpen(true)}><Archive className="h-4 w-4" /> Archive</Button>
            ))}
          </div>
        }
      />

      {err && <p className="mb-4 text-[12px] text-danger">{err}</p>}
      {!mayEdit && <div className="mb-4"><PermissionDenied message={priv ? "Private consent files are managed by hotel admins and reception." : "Your role can view this asset but not edit it."} /></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left — preview + usage */}
        <div className="space-y-4">
          <AssetPreview asset={a} />
          <Card className="p-5"><UsagePanel assetId={a.id} hotelId={currentHotel?.id} canManage={mayEdit} isPrivate={a.isPrivate} /></Card>
        </div>

        {/* Right — metadata */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Details</div>
            <dl className="space-y-2 text-[13px]">
              <Row label="Filename">{a.originalFilename ?? "—"}</Row>
              <Row label="Size">{a.isExternal ? "external" : humanBytes(a.fileSizeBytes)}</Row>
              {a.width && <Row label="Dimensions">{a.width}×{a.height}</Row>}
              {a.durationSeconds && <Row label="Duration">{a.durationSeconds}s</Row>}
              <Row label="Uses">{a.usageCount}</Row>
              <Row label="Created">{new Date(a.createdAt).toLocaleDateString()}</Row>
            </dl>
          </Card>

          <Card className="p-5">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Metadata</div>
            <div className="space-y-3">
              <TextField label="Display name" value={form.displayName ?? ""} onChange={(v) => set("displayName", v)} disabled={!mayEdit} />
              {isImageLike && <TextField label="Alt text" value={form.altText ?? ""} onChange={(v) => set("altText", v)} disabled={!mayEdit} placeholder="Describe the image" />}
              <TextAreaField label="Caption" value={form.caption ?? ""} onChange={(v) => set("caption", v)} disabled={!mayEdit} rows={2} />
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
          <DialogHeader><DialogTitle>Archive this asset?</DialogTitle><DialogDescription>{a.usageCount > 0 ? `This asset is used in ${a.usageCount} place${a.usageCount > 1 ? "s" : ""}. Detach those usages first — the database blocks archiving assets still in use.` : "It will be hidden from the library but not deleted. You can restore it anytime."}</DialogDescription></DialogHeader>
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
