"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Loader2, Save, UploadCloud, History, Archive, ArchiveRestore, Eye,
  Landmark, MapPin, Phone, FileText, Image as ImageIcon, Building2, AlertTriangle, CheckCircle2, RotateCcw, Clock, ScrollText,
} from "lucide-react";
import {
  usePoi, useUpdatePoi, usePublishPoi, useRollbackPoi, usePoiVersions, useSetPoiArchived,
  usePoiHotelUsage, usePublicAssets, hasUnpublishedPoiChanges, isValidPoiKey,
  POI_CATEGORIES, SOURCE_TYPES, VERIFICATION_STATUSES,
  type Poi, type PoiCategory, type ContentSourceType, type VerificationStatus,
} from "@/data/platform-pois";
import { usePlatform } from "@/providers/platform-provider";
import { StatusBadge, VerificationBadge } from "@/components/platform/destination-status-badge";
import { BlockEditor } from "@/components/content/block-editor-lazy";
import { BlockView } from "@/components/content/block-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import type { BlockBody } from "@/data/types";

const LABEL = "block text-[12px] font-medium text-ink-secondary";
const SELECT_CLS = "w-full appearance-none rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2 text-sm text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2";
const TA_CLS = "w-full rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2 text-sm text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2";

type Form = {
  name: string; key: string; category: PoiCategory; short_description: string;
  address: string; latitude: string; longitude: string; map_url: string;
  website: string; phone: string; opening_info: string; accessibility_info: string;
  price_info: string; recommended_duration_minutes: string;
  valid_from: string; valid_to: string;
  source_type: ContentSourceType; source_name: string; source_url: string;
  last_verified_at: string; verification_status: VerificationStatus; rights_notes: string;
  featured_default: boolean; canonical_asset_id: string;
};
const d10 = (s: string | null) => (s ? s.slice(0, 10) : "");
function toForm(p: Poi): Form {
  return {
    name: p.name ?? "", key: p.key ?? "", category: p.category, short_description: p.short_description ?? "",
    address: p.address ?? "", latitude: p.latitude?.toString() ?? "", longitude: p.longitude?.toString() ?? "", map_url: p.map_url ?? "",
    website: p.website ?? "", phone: p.phone ?? "", opening_info: p.opening_info ?? "", accessibility_info: p.accessibility_info ?? "",
    price_info: p.price_info ?? "", recommended_duration_minutes: p.recommended_duration_minutes?.toString() ?? "",
    valid_from: d10(p.valid_from), valid_to: d10(p.valid_to),
    source_type: p.source_type, source_name: p.source_name ?? "", source_url: p.source_url ?? "",
    last_verified_at: d10(p.last_verified_at), verification_status: p.verification_status, rights_notes: p.rights_notes ?? "",
    featured_default: p.featured_default, canonical_asset_id: p.canonical_asset_id ?? "",
  };
}

export default function PoiEditorPage() {
  const params = useParams();
  const id = Array.isArray(params.poiId) ? params.poiId[0] : (params.poiId as string);
  const { setDestination, currentDestination } = usePlatform();

  const { data: poi, isLoading, isError, error } = usePoi(id);
  const usage = usePoiHotelUsage(id, poi?.destination_id);
  const assets = usePublicAssets(poi?.destination_id);
  const update = useUpdatePoi();
  const publish = usePublishPoi();
  const archive = useSetPoiArchived();

  const [form, setForm] = React.useState<Form | null>(null);
  const [body, setBody] = React.useState<BlockBody | null>(null);
  const [changeSummary, setChangeSummary] = React.useState("");
  const [preview, setPreview] = React.useState<"draft" | "live">("draft");
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);

  React.useEffect(() => { if (poi) { setForm(toForm(poi)); setBody(poi.body_content ?? null); } }, [poi?.id, poi?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (poi?.destination_id) setDestination(poi.destination_id); }, [poi?.destination_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  if (isError) return <ErrorState message={(error as any)?.message} />;
  if (!isLoading && !poi) return <ErrorState message="This POI doesn’t exist or was removed." />;
  if (isLoading || !poi || !form) return <LoadingState />;

  const keyValid = isValidPoiKey(form.key);
  const latNum = form.latitude.trim() === "" ? null : Number(form.latitude);
  const lngNum = form.longitude.trim() === "" ? null : Number(form.longitude);
  const coordsValid =
    (latNum === null || (!Number.isNaN(latNum) && latNum >= -90 && latNum <= 90)) &&
    (lngNum === null || (!Number.isNaN(lngNum) && lngNum >= -180 && lngNum <= 180));
  const durNum = form.recommended_duration_minutes.trim() === "" ? null : Math.max(0, Math.round(Number(form.recommended_duration_minutes)));
  const canSave = form.name.trim().length >= 2 && keyValid && coordsValid;

  const patch = () => ({
    name: form.name.trim(), key: form.key.trim(), category: form.category,
    short_description: form.short_description.trim() || null,
    body_content: body && (body.blocks?.length ?? 0) > 0 ? body : null,
    address: form.address.trim() || null, latitude: latNum, longitude: lngNum, map_url: form.map_url.trim() || null,
    website: form.website.trim() || null, phone: form.phone.trim() || null,
    opening_info: form.opening_info.trim() || null, accessibility_info: form.accessibility_info.trim() || null,
    price_info: form.price_info.trim() || null, recommended_duration_minutes: durNum,
    valid_from: form.valid_from ? new Date(form.valid_from).toISOString() : null,
    valid_to: form.valid_to ? new Date(form.valid_to).toISOString() : null,
    source_type: form.source_type, source_name: form.source_name.trim() || null, source_url: form.source_url.trim() || null,
    last_verified_at: form.last_verified_at ? new Date(form.last_verified_at).toISOString() : null,
    verification_status: form.verification_status, rights_notes: form.rights_notes.trim() || null,
    featured_default: form.featured_default, canonical_asset_id: form.canonical_asset_id || null,
  });

  async function saveDraft() {
    setMsg(null);
    try { await update.mutateAsync({ id, patch: patch() }); setMsg({ tone: "ok", text: "Draft saved." }); }
    catch (e: any) { setMsg({ tone: "err", text: e?.code === "23505" ? "Key already exists in this destination." : (e?.message ?? "Save failed.") }); }
  }
  async function doPublish() {
    setMsg(null);
    try {
      if (canSave) await update.mutateAsync({ id, patch: patch() });
      await publish.mutateAsync({ id, changeSummary: changeSummary.trim() || undefined });
      setChangeSummary(""); setMsg({ tone: "ok", text: "Published — live for all hotels in this destination." });
    } catch (e: any) { setMsg({ tone: "err", text: e?.message ?? "Publish failed." }); }
  }
  async function toggleArchive() {
    setMsg(null);
    const archived = poi!.status !== "archived";
    try { await archive.mutateAsync({ id, archived }); setMsg({ tone: "ok", text: archived ? "POI archived — excluded from hotel consumption." : "POI restored to draft." }); }
    catch (e: any) { setMsg({ tone: "err", text: e?.message ?? "Action failed." }); }
  }

  const unpublished = hasUnpublishedPoiChanges(poi) || JSON.stringify(body ?? null) !== JSON.stringify(poi.published_snapshot ? (poi.published_snapshot as any).body_content ?? null : poi.body_content ?? null);
  const live = (poi.published_snapshot ?? null) as any;
  const busy = update.isPending || publish.isPending || archive.isPending;
  const selectedAsset = assets.data?.find((a) => a.id === form.canonical_asset_id);

  const warnings: string[] = [];
  if (poi.status === "draft") warnings.push("Not yet published — hotels can’t see this POI.");
  if (!form.short_description.trim()) warnings.push("No short description.");
  if (latNum === null || lngNum === null) warnings.push("Coordinates incomplete.");
  if (!form.source_url.trim() && form.source_type !== "manual") warnings.push("Non-manual source has no source URL/reference.");
  if (form.verification_status !== "verified") warnings.push(`Verification status is “${form.verification_status}”.`);
  if (!form.canonical_asset_id) warnings.push("No canonical media selected.");
  if (unpublished) warnings.push("Draft has unpublished changes.");

  const previewSrc = preview === "live" && live ? live : { ...patch(), body_content: patch().body_content };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href="/platform/pois" className="inline-flex items-center gap-1.5 text-[13px] text-ink-tertiary hover:text-ink-primary">
            <ArrowLeft className="h-4 w-4" /> POIs · {currentDestination?.name ?? "…"}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold text-ink-primary">{form.name || "Untitled"}</h1>
            <StatusBadge status={poi.status} />
            <VerificationBadge status={poi.verification_status} />
            {unpublished && <span className="rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">unpublished changes</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HistoryDialog id={id} />
          <Button variant="ghost" size="sm" onClick={toggleArchive} disabled={busy}>
            {poi.status === "archived" ? <><ArchiveRestore className="h-4 w-4" /> Restore</> : <><Archive className="h-4 w-4" /> Archive</>}
          </Button>
          <Button variant="secondary" size="sm" onClick={saveDraft} disabled={!canSave || busy}>
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft
          </Button>
        </div>
      </div>

      {msg && <p className={`rounded-md px-3 py-2 text-[13px] ${msg.tone === "ok" ? "bg-success-soft/50 text-success" : "bg-danger-soft/50 text-danger"}`}>{msg.text}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* LEFT */}
        <div className="space-y-4">
          <Section icon={Landmark} title="Identity">
            <Grid>
              <Field label="Title"><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label="Key" hint={keyValid ? undefined : "lowercase-hyphenated"}>
                <Input value={form.key} onChange={(e) => set("key", e.target.value)} aria-invalid={!keyValid} />
              </Field>
              <Field label="Category">
                <select className={SELECT_CLS} value={form.category} onChange={(e) => set("category", e.target.value as PoiCategory)}>
                  {POI_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Featured by default">
                <label className="flex h-[38px] items-center gap-2 text-[13px] text-ink-secondary">
                  <input type="checkbox" checked={form.featured_default} onChange={(e) => set("featured_default", e.target.checked)} className="h-4 w-4 rounded border-border-strong" />
                  Suggest hotels feature this POI
                </label>
              </Field>
            </Grid>
            <Field label="Short description">
              <textarea className={TA_CLS} rows={2} value={form.short_description} onChange={(e) => set("short_description", e.target.value)} />
            </Field>
          </Section>

          <Section icon={ScrollText} title="Full content">
            <BlockEditor body={body} onChange={setBody} />
          </Section>

          <Section icon={MapPin} title="Location">
            <Field label="Address"><Input value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
            <Grid>
              <Field label="Latitude" hint={coordsValid ? undefined : "−90…90"}><Input value={form.latitude} onChange={(e) => set("latitude", e.target.value)} inputMode="decimal" /></Field>
              <Field label="Longitude" hint={coordsValid ? undefined : "−180…180"}><Input value={form.longitude} onChange={(e) => set("longitude", e.target.value)} inputMode="decimal" /></Field>
            </Grid>
            <Field label="Map URL"><Input value={form.map_url} onChange={(e) => set("map_url", e.target.value)} placeholder="https://maps…" /></Field>
          </Section>

          <Section icon={Phone} title="Visitor info">
            <Grid>
              <Field label="Website"><Input value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" /></Field>
              <Field label="Phone"><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
            </Grid>
            <Field label="Opening information"><textarea className={TA_CLS} rows={2} value={form.opening_info} onChange={(e) => set("opening_info", e.target.value)} /></Field>
            <Field label="Accessibility information"><textarea className={TA_CLS} rows={2} value={form.accessibility_info} onChange={(e) => set("accessibility_info", e.target.value)} /></Field>
            <Grid>
              <Field label="Entry / price information"><Input value={form.price_info} onChange={(e) => set("price_info", e.target.value)} /></Field>
              <Field label="Recommended duration (min)"><Input value={form.recommended_duration_minutes} onChange={(e) => set("recommended_duration_minutes", e.target.value)} inputMode="numeric" /></Field>
            </Grid>
          </Section>

          <Section icon={Clock} title="Validity">
            <Grid>
              <Field label="Valid from"><Input type="date" value={form.valid_from} onChange={(e) => set("valid_from", e.target.value)} /></Field>
              <Field label="Valid to"><Input type="date" value={form.valid_to} onChange={(e) => set("valid_to", e.target.value)} /></Field>
            </Grid>
          </Section>

          <Section icon={ImageIcon} title="Canonical media">
            <Field label="Public platform/destination asset">
              <select className={SELECT_CLS} value={form.canonical_asset_id} onChange={(e) => set("canonical_asset_id", e.target.value)}>
                <option value="">— None —</option>
                {(assets.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.label} ({a.owner_scope})</option>)}
              </select>
            </Field>
            {selectedAsset && (
              <div className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface-sunken p-2 text-[12px] text-ink-secondary">
                {selectedAsset.preview_url
                  ? <img src={selectedAsset.preview_url} alt={selectedAsset.label} className="h-10 w-10 rounded object-cover" />
                  : <span className="flex h-10 w-10 items-center justify-center rounded bg-brand-navy/40"><ImageIcon className="h-4 w-4 text-brand-cream" /></span>}
                <span className="min-w-0"><span className="block truncate text-ink-primary">{selectedAsset.label}</span><span className="text-ink-tertiary">{selectedAsset.asset_type} · reference only, no per-hotel copy</span></span>
              </div>
            )}
            <p className="text-[11px] text-ink-tertiary">Selecting an existing asset references it (via assets/asset_usages) — never duplicated per hotel. Uploads live in the Asset Manager.</p>
          </Section>

          <Section icon={FileText} title="Source & provenance">
            <Grid>
              <Field label="Source">
                <select className={SELECT_CLS} value={form.source_type} onChange={(e) => set("source_type", e.target.value as ContentSourceType)}>
                  {SOURCE_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Source name"><Input value={form.source_name} onChange={(e) => set("source_name", e.target.value)} /></Field>
              <Field label="Source URL / reference"><Input value={form.source_url} onChange={(e) => set("source_url", e.target.value)} placeholder="https://…" /></Field>
              <Field label="Last verified date"><Input type="date" value={form.last_verified_at} onChange={(e) => set("last_verified_at", e.target.value)} /></Field>
              <Field label="Verification status">
                <select className={SELECT_CLS} value={form.verification_status} onChange={(e) => set("verification_status", e.target.value as VerificationStatus)}>
                  {VERIFICATION_STATUSES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
              </Field>
              <Field label="Rights / source notes"><Input value={form.rights_notes} onChange={(e) => set("rights_notes", e.target.value)} /></Field>
            </Grid>
          </Section>
        </div>

        {/* RIGHT */}
        <div className="space-y-4">
          <Section icon={Eye} title="Preview" action={
            <div className="flex overflow-hidden rounded-md border border-border-subtle text-[11px]">
              <button onClick={() => setPreview("draft")} className={`px-2 py-1 ${preview === "draft" ? "bg-brand-navy/60 text-ink-primary" : "text-ink-tertiary"}`}>Draft</button>
              <button onClick={() => setPreview("live")} disabled={!live} className={`px-2 py-1 ${preview === "live" ? "bg-brand-navy/60 text-ink-primary" : "text-ink-tertiary"} disabled:opacity-40`}>Live</button>
            </div>
          }>
            {preview === "live" && !live
              ? <p className="text-[12px] text-ink-tertiary">No live version yet — publish to create one.</p>
              : <GuestPreview src={previewSrc} isLive={preview === "live"} />}
          </Section>

          <Section icon={UploadCloud} title="Publishing">
            <p className="text-[12px] text-ink-tertiary">Publishing pushes the current draft live for all hotels in this destination that show this POI.</p>
            <textarea className={TA_CLS} rows={2} placeholder="Change summary (optional)" value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} />
            <Button variant="primary" size="sm" className="w-full" onClick={doPublish} disabled={busy || !canSave}>
              {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Publish POI
            </Button>
            {poi.published_at && <p className="text-[11px] text-ink-tertiary">Last published {new Date(poi.published_at).toLocaleString()}</p>}
          </Section>

          <Section icon={Building2} title="Hotel usage">
            {usage.isLoading ? <Skeleton className="h-24 w-full rounded-md" /> : (
              <div className="grid grid-cols-2 gap-2 text-[13px]">
                <Usage label="Hotels in destination" n={usage.data?.hotelsInDestination ?? 0} />
                <Usage label="Customized by" n={usage.data?.customized ?? 0} />
                <Usage label="Hidden by" n={usage.data?.hiddenBy ?? 0} />
                <Usage label="Featured by" n={usage.data?.featuredBy ?? 0} />
                <Usage label="Custom recommendation" n={usage.data?.recommendations ?? 0} />
                <Usage label="Custom image override" n={usage.data?.imageOverrides ?? 0} />
              </div>
            )}
            <p className="text-[11px] text-ink-tertiary">Read-only. Hotels manage presentation in the Hotel CMS — never here.</p>
          </Section>

          <Section icon={AlertTriangle} title="Warnings">
            {warnings.length === 0 ? (
              <p className="inline-flex items-center gap-1.5 text-[13px] text-success"><CheckCircle2 className="h-4 w-4" /> No warnings.</p>
            ) : (
              <ul className="space-y-1">{warnings.map((w, i) => (
                <li key={i} className="inline-flex items-start gap-1.5 text-[12px] text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}</li>
              ))}</ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function Section({ icon: Icon, title, action, children }: { icon: any; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border-subtle bg-surface-raised p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-primary"><Icon className="h-4 w-4 text-ink-tertiary" /> {title}</h2>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
function Grid({ children }: { children: React.ReactNode }) { return <div className="grid gap-3 sm:grid-cols-2">{children}</div>; }
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className={LABEL}>{label}</label>{children}{hint && <p className="text-[11px] text-warning">{hint}</p>}</div>;
}
function Usage({ label, n }: { label: string; n: number }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2">
      <span className="min-w-0 flex-1 truncate text-ink-secondary">{label}</span>
      <span className="font-semibold text-ink-primary">{n}</span>
    </div>
  );
}
function GuestPreview({ src, isLive }: { src: any; isLive: boolean }) {
  const cat = POI_CATEGORIES.find((c) => c.value === src.category)?.label ?? src.category;
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken p-3">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-tertiary">{isLive ? "Live (published)" : "Draft"}</div>
      <div className="text-base font-semibold text-ink-primary">{src.name || "Untitled"}</div>
      <div className="text-[12px] text-ink-tertiary">{[cat, src.address].filter(Boolean).join(" · ")}</div>
      {src.short_description && <p className="mt-2 text-[13px] text-ink-secondary">{src.short_description}</p>}
      <div className="mt-2"><BlockView body={(src.body_content ?? null) as BlockBody | null} /></div>
      <div className="mt-2 space-y-0.5 text-[11px] text-ink-tertiary">
        {src.opening_info && <div>Hours: {src.opening_info}</div>}
        {src.price_info && <div>Entry: {src.price_info}</div>}
        {(src.recommended_duration_minutes ?? null) !== null && <div>~{src.recommended_duration_minutes} min</div>}
        {(src.latitude ?? null) !== null && (src.longitude ?? null) !== null && <div>{Number(src.latitude).toFixed(3)}, {Number(src.longitude).toFixed(3)}</div>}
      </div>
    </div>
  );
}

function HistoryDialog({ id }: { id: string }) {
  const { data: versions = [], isLoading } = usePoiVersions(id);
  const rollback = useRollbackPoi();
  const [busyV, setBusyV] = React.useState<string | null>(null);
  return (
    <Dialog>
      <DialogTrigger asChild><Button variant="ghost" size="sm"><History className="h-4 w-4" /> History</Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>Published versions. Rolling back restores that snapshot into a new draft (live stays until you re-publish).</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2 py-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)}</div>
        ) : versions.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-ink-tertiary">No published versions yet.</p>
        ) : (
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto py-1">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface-sunken px-3 py-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-navy/50 text-[12px] font-semibold text-brand-cream">v{v.version_number}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink-primary">{v.change_summary || "(no summary)"}</div>
                  <div className="text-[11px] text-ink-tertiary">{new Date(v.published_at ?? v.created_at).toLocaleString()}</div>
                </div>
                <Button variant="ghost" size="sm" disabled={busyV === v.id}
                  onClick={async () => { setBusyV(v.id); try { await rollback.mutateAsync({ id, versionId: v.id }); } finally { setBusyV(null); } }}>
                  {busyV === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Roll back
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end pt-2"><DialogClose asChild><Button variant="secondary" size="sm">Close</Button></DialogClose></div>
      </DialogContent>
    </Dialog>
  );
}

function LoadingState() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <Skeleton className="h-6 w-40" />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}</div>
        <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}</div>
      </div>
    </div>
  );
}
function ErrorState({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="rounded-xl border border-danger/30 bg-danger-soft/40 p-6 text-center">
        <AlertTriangle className="mx-auto h-6 w-6 text-danger" />
        <p className="mt-2 text-sm text-ink-secondary">Couldn’t load this POI. {message}</p>
        <Button asChild variant="secondary" size="sm" className="mt-3"><Link href="/platform/pois">Back to POIs</Link></Button>
      </div>
    </div>
  );
}
