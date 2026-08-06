"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, File as FileIcon, X, AlertTriangle, Video, Image as ImageIcon, Globe, Building2 } from "lucide-react";
import { usePlatform } from "@/providers/platform-provider";
import {
  useCreatePlatformPublicAsset, useCreatePlatformExternalAsset, platformMediaPath, uploadPublicObject,
  PLATFORM_MEDIA_TYPES,
} from "@/data/platform-media";
import { assetMaxBytes, bucketForType, BUCKET_MIME, humanBytes, ASSET_TYPE_LABEL, assetKind, type AssetType } from "@/data/asset-constants";
import { humanizeError } from "@/data/errors";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, TextField, TextAreaField } from "@/components/content/fields";
import { cn } from "@/lib/utils";

// Only public-bucket image/audio types are uploadable at platform scope; short_video
// is added via the external-reference tab (no large-file upload in the CMS).
const UPLOADABLE: AssetType[] = PLATFORM_MEDIA_TYPES.filter((t) => bucketForType(t) === "public-media" && t !== "short_video");

function defaultType(mime: string): AssetType {
  if (mime.startsWith("image/")) return "poi_image";
  if (mime.startsWith("audio/")) return "whisper_audio";
  return "poi_image";
}

function ScopePicker({ value, onChange, disabled }: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean }) {
  const { destinations } = usePlatform();
  return (
    <Field label="Ownership" hint="Who owns this canonical media">
      <select value={value ?? "__platform"} onChange={(e) => onChange(e.target.value === "__platform" ? null : e.target.value)} disabled={disabled}
        className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none disabled:opacity-50">
        <option value="__platform">Platform-wide (all destinations)</option>
        {destinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </Field>
  );
}

export default function PlatformMediaUploadPage() {
  const router = useRouter();
  const [tab, setTab] = React.useState<"file" | "external">("file");
  return (
    <div className="mx-auto max-w-[760px] p-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-ink-primary">Add media</h1>
        <p className="mt-1 text-sm text-ink-tertiary">Upload an image or audio file, or reference an external video. Owned by the platform or a destination — hotels reference it, never edit it.</p>
      </header>
      <div className="mb-4 flex items-center gap-1 border-b border-border-subtle">
        {(["file", "external"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("relative px-3 py-2 text-[13px] font-medium transition-colors", tab === t ? "text-ink-primary" : "text-ink-tertiary hover:text-ink-secondary")}>
            {t === "file" ? "Upload file" : "External video"}
            {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-cream" />}
          </button>
        ))}
      </div>
      {tab === "file"
        ? <FileUpload onDone={(id) => router.push(`/platform/media/${id}`)} />
        : <ExternalForm onDone={(id) => router.push(`/platform/media/${id}`)} />}
    </div>
  );
}

function FileUpload({ onDone }: { onDone: (id: string) => void }) {
  const createPublic = useCreatePlatformPublicAsset();
  const [destinationId, setDestinationId] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [assetType, setAssetType] = React.useState<AssetType>("poi_image");
  const [displayName, setDisplayName] = React.useState("");
  const [altText, setAltText] = React.useState("");
  const [caption, setCaption] = React.useState("");
  const [credit, setCredit] = React.useState("");
  const [rightsOwner, setRightsOwner] = React.useState("");
  const [license, setLicense] = React.useState("");
  const [dims, setDims] = React.useState<{ w: number; h: number } | null>(null);
  const [progress, setProgress] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [drag, setDrag] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const pick = (f: File) => {
    setError(null); setDims(null);
    setFile(f); setAssetType(defaultType(f.type)); setDisplayName(f.name.replace(/\.[^.]+$/, ""));
    if (f.type.startsWith("image/") && f.type !== "image/svg+xml") {
      const img = new Image(); img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight }); img.src = URL.createObjectURL(f);
    }
  };

  const bucket = bucketForType(assetType);
  const validation = React.useMemo(() => {
    if (!file) return null;
    if (!BUCKET_MIME[bucket].includes(file.type)) return `Type ${file.type || "unknown"} isn't allowed for ${ASSET_TYPE_LABEL[assetType]}.`;
    if (file.size > assetMaxBytes(assetType)) return `Too large — ${humanBytes(file.size)} exceeds the ${humanBytes(assetMaxBytes(assetType))} limit for ${ASSET_TYPE_LABEL[assetType]}.`;
    return null;
  }, [file, assetType, bucket]);

  const isImage = ["image", "logo", "icon"].includes(assetKind(assetType));

  const submit = async () => {
    if (!file || validation) return;
    setBusy(true); setError(null); setProgress(5);
    try {
      const id = crypto.randomUUID();
      const path = platformMediaPath(destinationId, assetType, id, file.name);
      await uploadPublicObject("public-media", path, file, setProgress);
      const newId = await createPublic.mutateAsync({
        destinationId, assetType, storagePath: path, originalFilename: file.name, displayName: displayName.trim() || file.name,
        mimeType: file.type, fileSizeBytes: file.size, width: dims?.w ?? null, height: dims?.h ?? null,
        altText: altText.trim() || null, caption: caption.trim() || null, sourceCredit: credit.trim() || null,
        rightsOwner: rightsOwner.trim() || null, licenseType: license.trim() || null,
      });
      onDone(newId);
    } catch (e) { setError(humanizeError(e)); setBusy(false); setProgress(0); }
  };

  return (
    <div className="space-y-4">
      {!file ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) pick(f); }}
          onClick={() => inputRef.current?.click()}
          className={cn("grid cursor-pointer place-items-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors", drag ? "border-brand-goldDeep bg-surface-overlay/40" : "border-border-strong hover:border-brand-goldDeep/60")}
        >
          <UploadCloud className="h-8 w-8 text-ink-tertiary" />
          <p className="mt-3 text-[14px] font-medium text-ink-primary">Drop a file here, or click to choose</p>
          <p className="mt-1 text-[12px] text-ink-tertiary">Images 15MB · Audio 50MB</p>
          <input ref={inputRef} type="file" className="hidden" accept="image/*,audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); }} />
        </div>
      ) : (
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-overlay text-ink-tertiary">{isImage ? <ImageIcon className="h-5 w-5" /> : <FileIcon className="h-5 w-5" />}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-ink-primary">{file.name}</div>
              <div className="text-[12px] text-ink-tertiary">{humanBytes(file.size)}{dims ? ` · ${dims.w}×${dims.h}` : ""}{file.type ? ` · ${file.type}` : ""}</div>
            </div>
            {!busy && <button onClick={() => { setFile(null); setProgress(0); }} className="rounded p-1 text-ink-tertiary hover:text-ink-primary"><X className="h-4 w-4" /></button>}
          </div>

          {validation && <p className="mb-3 flex items-center gap-1.5 rounded-md border border-danger/30 bg-danger-soft/40 px-3 py-2 text-[12px] text-danger"><AlertTriangle className="h-3.5 w-3.5" /> {validation}</p>}

          <div className="space-y-3">
            <ScopePicker value={destinationId} onChange={setDestinationId} disabled={busy} />
            <Field label="Asset type">
              <select value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)} disabled={busy} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none disabled:opacity-50">
                {UPLOADABLE.map((t) => <option key={t} value={t}>{ASSET_TYPE_LABEL[t]}</option>)}
              </select>
            </Field>
            <TextField label="Display name" value={displayName} onChange={setDisplayName} disabled={busy} />
            {isImage && <TextField label="Alt text" hint="for accessibility & AI" value={altText} onChange={setAltText} disabled={busy} placeholder="Describe the image" />}
            <TextAreaField label="Caption" value={caption} onChange={setCaption} disabled={busy} rows={2} />
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField label="Source credit" value={credit} onChange={setCredit} disabled={busy} />
              <TextField label="Rights owner" value={rightsOwner} onChange={setRightsOwner} disabled={busy} />
              <TextField label="License" value={license} onChange={setLicense} disabled={busy} />
            </div>
          </div>

          {busy && (
            <div className="mt-4">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-overlay"><div className="h-full bg-brand-cream transition-all" style={{ width: `${progress}%` }} /></div>
              <p className="mt-1 text-[11px] text-ink-tertiary">Uploading… {progress}%</p>
            </div>
          )}
          {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setFile(null); setError(null); }} disabled={busy}>Choose different</Button>
            <Button variant="primary" onClick={submit} loading={busy} disabled={!!validation}><UploadCloud className="h-4 w-4" /> Upload</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function ExternalForm({ onDone }: { onDone: (id: string) => void }) {
  const createExternal = useCreatePlatformExternalAsset();
  const [destinationId, setDestinationId] = React.useState<string | null>(null);
  const [provider, setProvider] = React.useState("vimeo");
  const [url, setUrl] = React.useState("");
  const [externalId, setExternalId] = React.useState("");
  const [name, setName] = React.useState("");
  const [caption, setCaption] = React.useState("");
  const [credit, setCredit] = React.useState("");
  const [rightsOwner, setRightsOwner] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!url.trim() || !name.trim()) { setError("Name and URL are required."); return; }
    try {
      const id = await createExternal.mutateAsync({
        destinationId, assetType: "short_video", provider, url: url.trim(), externalId: externalId.trim() || undefined,
        displayName: name.trim(), caption: caption.trim() || undefined, sourceCredit: credit.trim() || undefined, rightsOwner: rightsOwner.trim() || undefined,
      });
      onDone(id);
    } catch (e) { setError(humanizeError(e)); }
  };

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2 text-[13px] text-ink-secondary"><Video className="h-4 w-4 text-ink-tertiary" /> Reference an external video. No API integration — metadata only.</div>
      <div className="space-y-3">
        <ScopePicker value={destinationId} onChange={setDestinationId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Provider"><select value={provider} onChange={(e) => setProvider(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">{["vimeo", "youtube", "cdn"].map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
          <Field label="External ID" hint="optional"><Input value={externalId} onChange={(e) => setExternalId(e.target.value)} placeholder="123456789" /></Field>
        </div>
        <TextField label="URL" value={url} onChange={setUrl} placeholder="https://vimeo.com/123456789" />
        <TextField label="Display name" value={name} onChange={setName} />
        <TextAreaField label="Caption" value={caption} onChange={setCaption} rows={2} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Source credit" value={credit} onChange={setCredit} />
          <TextField label="Rights owner" value={rightsOwner} onChange={setRightsOwner} />
        </div>
        {error && <p className="text-[12px] text-danger">{error}</p>}
        <div className="flex justify-end"><Button variant="primary" onClick={submit} loading={createExternal.isPending}>Add video reference</Button></div>
      </div>
    </Card>
  );
}
