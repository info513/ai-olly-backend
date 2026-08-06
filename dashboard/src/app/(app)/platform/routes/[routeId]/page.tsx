"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Loader2, Save, UploadCloud, History, Archive, ArchiveRestore, Eye,
  Route as RouteIcon, MapPin, Shield, FileText, Image as ImageIcon, Building2, AlertTriangle, CheckCircle2, RotateCcw, Clock, Gauge, ScrollText, ListOrdered, Calendar,
} from "lucide-react";
import {
  useRoute, useUpdateRoute, usePublishRoute, useRollbackRoute, useRouteVersions, useSetRouteArchived,
  useRouteHotelUsage, usePois, usePublicAssets, hasUnpublishedRouteChanges, isValidRouteKey,
  readStops, writeStops, ROUTE_TYPES, ROUTE_DIFFICULTIES, SOURCE_TYPES, VERIFICATION_STATUSES, POI_CATEGORIES,
  type Route, type RouteType, type RouteDifficulty, type ContentSourceType, type VerificationStatus, type Waypoint, type Poi,
} from "@/data/platform-routes";
import { usePlatform } from "@/providers/platform-provider";
import { StatusBadge, VerificationBadge } from "@/components/platform/destination-status-badge";
import { RouteWaypointEditor } from "@/components/platform/route-waypoint-editor";
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
const catLabel = (c?: string) => POI_CATEGORIES.find((x) => x.value === c)?.label ?? c ?? "";
// Stable empty reference — avoids a new [] each render feeding the poisByKey memo
// and the stops-sync effect (which would loop: new array → effect → setState → …).
const EMPTY_POIS: Poi[] = [];

type Form = {
  name: string; key: string; route_type: RouteType; short_description: string;
  difficulty: "" | RouteDifficulty; distance_km: string; duration_minutes: string;
  start_location: string; end_location: string; map_url: string; polyline: string;
  accessibility_info: string; safety_notes: string; seasonality: string; recommended_equipment: string;
  valid_from: string; valid_to: string;
  source_type: ContentSourceType; source_name: string; source_url: string;
  last_verified_at: string; verification_status: VerificationStatus; rights_notes: string;
  featured_default: boolean; canonical_asset_id: string;
};
const d10 = (s: string | null) => (s ? s.slice(0, 10) : "");
function toForm(r: Route): Form {
  return {
    name: r.name ?? "", key: r.key ?? "", route_type: r.route_type, short_description: r.short_description ?? "",
    difficulty: r.difficulty ?? "", distance_km: r.distance_km?.toString() ?? "", duration_minutes: r.duration_minutes?.toString() ?? "",
    start_location: r.start_location ?? "", end_location: r.end_location ?? "", map_url: r.map_url ?? "", polyline: r.polyline ?? "",
    accessibility_info: r.accessibility_info ?? "", safety_notes: r.safety_notes ?? "", seasonality: r.seasonality ?? "", recommended_equipment: r.recommended_equipment ?? "",
    valid_from: d10(r.valid_from), valid_to: d10(r.valid_to),
    source_type: r.source_type, source_name: r.source_name ?? "", source_url: r.source_url ?? "",
    last_verified_at: d10(r.last_verified_at), verification_status: r.verification_status, rights_notes: r.rights_notes ?? "",
    featured_default: r.featured_default, canonical_asset_id: r.canonical_asset_id ?? "",
  };
}

export default function RouteEditorPage() {
  const params = useParams();
  const id = Array.isArray(params.routeId) ? params.routeId[0] : (params.routeId as string);
  const { setDestination, currentDestination } = usePlatform();

  const { data: route, isLoading, isError, error } = useRoute(id);
  const pois = usePois(route?.destination_id, { includeArchived: true }).data ?? EMPTY_POIS;
  const usage = useRouteHotelUsage(id, route?.destination_id);
  const assets = usePublicAssets(route?.destination_id);
  const update = useUpdateRoute();
  const publish = usePublishRoute();
  const archive = useSetRouteArchived();

  const [form, setForm] = React.useState<Form | null>(null);
  const [body, setBody] = React.useState<BlockBody | null>(null);
  const [stops, setStops] = React.useState<Waypoint[]>([]);
  const [changeSummary, setChangeSummary] = React.useState("");
  const [preview, setPreview] = React.useState<"draft" | "live">("draft");
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const poisByKey = React.useMemo(() => new Map(pois.map((p) => [p.key, { id: p.id, key: p.key }])), [pois]);

  // Sync form/body once the route loads or changes. Waypoints derive stops (from
  // canonical stops, or from legacy keys once POIs are available).
  React.useEffect(() => {
    if (route) { setForm(toForm(route)); setBody(route.body_content ?? null); }
  }, [route?.id, route?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (route) setStops(readStops(route.waypoints, poisByKey));
  }, [route?.id, route?.updated_at, poisByKey]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (route?.destination_id) setDestination(route.destination_id); }, [route?.destination_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  if (isError) return <ErrorState message={(error as any)?.message} />;
  if (isLoading || !route || !form) return <LoadingState />;

  const keyValid = isValidRouteKey(form.key);
  const distNum = form.distance_km.trim() === "" ? null : Number(form.distance_km);
  const durNum = form.duration_minutes.trim() === "" ? null : Math.round(Number(form.duration_minutes));
  const distValid = distNum === null || (!Number.isNaN(distNum) && distNum >= 0);
  const durValid = durNum === null || (!Number.isNaN(durNum) && durNum >= 0);
  const canSave = form.name.trim().length >= 2 && keyValid && distValid && durValid;

  const patch = () => ({
    name: form.name.trim(), key: form.key.trim(), route_type: form.route_type,
    short_description: form.short_description.trim() || null,
    body_content: body && (body.blocks?.length ?? 0) > 0 ? body : null,
    difficulty: form.difficulty || null, distance_km: distNum, duration_minutes: durNum,
    waypoints: writeStops(stops),
    start_location: form.start_location.trim() || null, end_location: form.end_location.trim() || null,
    map_url: form.map_url.trim() || null, polyline: form.polyline.trim() || null,
    accessibility_info: form.accessibility_info.trim() || null, safety_notes: form.safety_notes.trim() || null,
    seasonality: form.seasonality.trim() || null, recommended_equipment: form.recommended_equipment.trim() || null,
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
    const archived = route!.status !== "archived";
    try { await archive.mutateAsync({ id, archived }); setMsg({ tone: "ok", text: archived ? "Route archived — excluded from hotel consumption." : "Route restored to draft." }); }
    catch (e: any) { setMsg({ tone: "err", text: e?.message ?? "Action failed." }); }
  }

  const liveStops = ((route.published_snapshot as any)?.waypoints?.stops ?? []) as Waypoint[];
  const unpublished = hasUnpublishedRouteChanges(route)
    || JSON.stringify(body ?? null) !== JSON.stringify((route.published_snapshot as any)?.body_content ?? route.body_content ?? null)
    || JSON.stringify(stops.map((s) => ({ p: s.poi_id, n: s.note ?? null }))) !== JSON.stringify(liveStops.map((s) => ({ p: s.poi_id, n: s.note ?? null })));
  const live = (route.published_snapshot ?? null) as any;
  const busy = update.isPending || publish.isPending || archive.isPending;
  const selectedAsset = assets.data?.find((a) => a.id === form.canonical_asset_id);

  const warnings: string[] = [];
  if (route.status === "draft") warnings.push("Not yet published — hotels can’t see this route.");
  if (stops.length < 2) warnings.push("A route usually needs at least 2 stops.");
  if (!form.difficulty) warnings.push("No difficulty set.");
  if (distNum === null) warnings.push("No distance set.");
  if (durNum === null) warnings.push("No estimated duration set.");
  if (!form.canonical_asset_id) warnings.push("No canonical media selected.");
  if (form.source_type !== "manual" && !form.source_url.trim()) warnings.push("Non-manual source has no source URL/reference.");
  if (form.verification_status !== "verified") warnings.push(`Verification status is “${form.verification_status}”.`);
  if (unpublished) warnings.push("Draft has unpublished changes.");

  const previewStops = preview === "live" ? liveStops : stops;
  const previewSrc = preview === "live" && live ? live : { ...patch() };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href="/platform/routes" className="inline-flex items-center gap-1.5 text-[13px] text-ink-tertiary hover:text-ink-primary">
            <ArrowLeft className="h-4 w-4" /> Routes · {currentDestination?.name ?? "…"}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold text-ink-primary">{form.name || "Untitled"}</h1>
            <StatusBadge status={route.status} />
            <VerificationBadge status={route.verification_status} />
            {unpublished && <span className="rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">unpublished changes</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HistoryDialog id={id} />
          <Button variant="ghost" size="sm" onClick={toggleArchive} disabled={busy}>
            {route.status === "archived" ? <><ArchiveRestore className="h-4 w-4" /> Restore</> : <><Archive className="h-4 w-4" /> Archive</>}
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
          <Section icon={RouteIcon} title="Identity">
            <Grid>
              <Field label="Title"><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label="Key" hint={keyValid ? undefined : "lowercase-hyphenated"}>
                <Input value={form.key} onChange={(e) => set("key", e.target.value)} aria-invalid={!keyValid} />
              </Field>
              <Field label="Route type">
                <select className={SELECT_CLS} value={form.route_type} onChange={(e) => set("route_type", e.target.value as RouteType)}>
                  {ROUTE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Featured by default">
                <label className="flex h-[38px] items-center gap-2 text-[13px] text-ink-secondary">
                  <input type="checkbox" checked={form.featured_default} onChange={(e) => set("featured_default", e.target.checked)} className="h-4 w-4 rounded border-border-strong" />
                  Suggest hotels feature this route
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

          <Section icon={ListOrdered} title={`Waypoints (${stops.length})`}>
            <RouteWaypointEditor stops={stops} pois={pois} onChange={setStops} />
          </Section>

          <Section icon={Gauge} title="Route summary">
            <Grid>
              <Field label="Difficulty">
                <select className={SELECT_CLS} value={form.difficulty} onChange={(e) => set("difficulty", e.target.value as any)}>
                  <option value="">— Unset —</option>
                  {ROUTE_DIFFICULTIES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </Field>
              <Field label="Distance (km)" hint={distValid ? undefined : "≥ 0"}><Input value={form.distance_km} onChange={(e) => set("distance_km", e.target.value)} inputMode="decimal" /></Field>
              <Field label="Estimated duration (min)" hint={durValid ? undefined : "≥ 0"}><Input value={form.duration_minutes} onChange={(e) => set("duration_minutes", e.target.value)} inputMode="numeric" /></Field>
              <Field label="Recommended equipment"><Input value={form.recommended_equipment} onChange={(e) => set("recommended_equipment", e.target.value)} /></Field>
              <Field label="Start location"><Input value={form.start_location} onChange={(e) => set("start_location", e.target.value)} /></Field>
              <Field label="End location"><Input value={form.end_location} onChange={(e) => set("end_location", e.target.value)} /></Field>
            </Grid>
            <Field label="Map URL"><Input value={form.map_url} onChange={(e) => set("map_url", e.target.value)} placeholder="https://maps…" /></Field>
            <Field label="Polyline / reference"><Input value={form.polyline} onChange={(e) => set("polyline", e.target.value)} placeholder="encoded polyline or GPX ref (optional)" /></Field>
          </Section>

          <Section icon={Shield} title="Access, safety & seasonality">
            <Field label="Accessibility"><textarea className={TA_CLS} rows={2} value={form.accessibility_info} onChange={(e) => set("accessibility_info", e.target.value)} /></Field>
            <Field label="Safety notes"><textarea className={TA_CLS} rows={2} value={form.safety_notes} onChange={(e) => set("safety_notes", e.target.value)} /></Field>
            <Field label="Seasonality"><Input value={form.seasonality} onChange={(e) => set("seasonality", e.target.value)} placeholder="e.g. best Apr–Oct" /></Field>
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
            <p className="text-[11px] text-ink-tertiary">Selecting an existing asset references it — never duplicated per hotel. Uploads live in the Asset Manager.</p>
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
            <Grid>
              <Field label="Valid from"><Input type="date" value={form.valid_from} onChange={(e) => set("valid_from", e.target.value)} /></Field>
              <Field label="Valid to"><Input type="date" value={form.valid_to} onChange={(e) => set("valid_to", e.target.value)} /></Field>
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
              : <RoutePreview src={previewSrc} stops={previewStops} pois={pois} body={preview === "live" ? ((live?.body_content ?? null) as BlockBody | null) : body} isLive={preview === "live"} />}
          </Section>

          <Section icon={UploadCloud} title="Publishing">
            <p className="text-[12px] text-ink-tertiary">Publishing pushes the current draft (incl. ordered waypoints) live for all hotels in this destination.</p>
            <textarea className={TA_CLS} rows={2} placeholder="Change summary (optional)" value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} />
            <Button variant="primary" size="sm" className="w-full" onClick={doPublish} disabled={busy || !canSave}>
              {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Publish route
            </Button>
            {route.published_at && <p className="text-[11px] text-ink-tertiary">Last published {new Date(route.published_at).toLocaleString()}</p>}
          </Section>

          <Section icon={Building2} title="Hotel usage">
            {usage.isLoading ? <Skeleton className="h-24 w-full rounded-md" /> : (
              <div className="grid grid-cols-2 gap-2 text-[13px]">
                <Usage label="Hotels in destination" n={usage.data?.hotelsInDestination ?? 0} />
                <Usage label="Customized by" n={usage.data?.customized ?? 0} />
                <Usage label="Hidden by" n={usage.data?.hiddenBy ?? 0} />
                <Usage label="Featured by" n={usage.data?.featuredBy ?? 0} />
                <Usage label="Custom recommendation" n={usage.data?.recommendations ?? 0} />
                <Usage label="Custom order" n={usage.data?.orderOverrides ?? 0} />
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
function RoutePreview({ src, stops, pois, body, isLive }: { src: any; stops: Waypoint[]; pois: any[]; body: BlockBody | null; isLive: boolean }) {
  const type = ROUTE_TYPES.find((t) => t.value === src.route_type)?.label ?? src.route_type;
  const diff = ROUTE_DIFFICULTIES.find((d) => d.value === src.difficulty)?.label;
  const byId = new Map(pois.map((p) => [p.id, p]));
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken p-3">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-tertiary">{isLive ? "Live (published)" : "Draft"}</div>
      <div className="text-base font-semibold text-ink-primary">{src.name || "Untitled"}</div>
      <div className="text-[12px] text-ink-tertiary">{[type, src.start_location && `from ${src.start_location}`, src.end_location && `to ${src.end_location}`].filter(Boolean).join(" · ")}</div>
      {src.short_description && <p className="mt-2 text-[13px] text-ink-secondary">{src.short_description}</p>}
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-ink-tertiary">
        {diff && <span className="inline-flex items-center gap-1"><Gauge className="h-3 w-3" />{diff}</span>}
        {(src.distance_km ?? null) !== null && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{src.distance_km} km</span>}
        {(src.duration_minutes ?? null) !== null && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{src.duration_minutes} min</span>}
        {src.seasonality && <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{src.seasonality}</span>}
      </div>
      {body && <div className="mt-2"><BlockView body={body} /></div>}
      {stops.length > 0 && (
        <ol className="mt-3 space-y-1">
          {stops.map((s, i) => {
            const poi = byId.get(s.poi_id);
            return (
              <li key={s.poi_id} className="flex items-start gap-2 text-[12px]">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-navy/60 text-[9px] font-semibold text-brand-cream">{i + 1}</span>
                <span className="min-w-0">
                  <span className="text-ink-primary">{poi?.name ?? s.poi_key ?? "Stop"}</span>
                  {poi?.category && <span className="text-ink-tertiary"> · {catLabel(poi.category)}</span>}
                  {s.note && <span className="block text-ink-tertiary">{s.note}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-2 space-y-0.5 text-[11px] text-ink-tertiary">
        {src.map_url && <div>Map: {src.map_url}</div>}
        {src.accessibility_info && <div>Accessibility: {src.accessibility_info}</div>}
        {src.safety_notes && <div>Safety: {src.safety_notes}</div>}
      </div>
    </div>
  );
}

function HistoryDialog({ id }: { id: string }) {
  const { data: versions = [], isLoading } = useRouteVersions(id);
  const rollback = useRollbackRoute();
  const [busyV, setBusyV] = React.useState<string | null>(null);
  return (
    <Dialog>
      <DialogTrigger asChild><Button variant="ghost" size="sm"><History className="h-4 w-4" /> History</Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>Published versions include the ordered waypoints. Rolling back restores that snapshot (stops + order) into a new draft; live stays until you re-publish.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2 py-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)}</div>
        ) : versions.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-ink-tertiary">No published versions yet.</p>
        ) : (
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto py-1">
            {versions.map((v) => {
              const n = ((v.snapshot as any)?.waypoints?.stops?.length) ?? null;
              return (
                <li key={v.id} className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface-sunken px-3 py-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-navy/50 text-[12px] font-semibold text-brand-cream">v{v.version_number}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-ink-primary">{v.change_summary || "(no summary)"}</div>
                    <div className="text-[11px] text-ink-tertiary">{new Date(v.published_at ?? v.created_at).toLocaleString()}{n !== null && ` · ${n} stop${n === 1 ? "" : "s"}`}</div>
                  </div>
                  <Button variant="ghost" size="sm" disabled={busyV === v.id}
                    onClick={async () => { setBusyV(v.id); try { await rollback.mutateAsync({ id, versionId: v.id }); } finally { setBusyV(null); } }}>
                    {busyV === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Roll back
                  </Button>
                </li>
              );
            })}
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
        <p className="mt-2 text-sm text-ink-secondary">Couldn’t load this route. {message}</p>
        <Button asChild variant="secondary" size="sm" className="mt-3"><Link href="/platform/routes">Back to routes</Link></Button>
      </div>
    </div>
  );
}
