"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Loader2, Save, UploadCloud, History, Archive, ArchiveRestore, Eye,
  MapPin, Globe, Search as SearchIcon, FileText, Building2, AlertTriangle, CheckCircle2, RotateCcw, Landmark, Route, Sparkles, CalendarDays,
} from "lucide-react";
import {
  useDestination, useUpdateDestination, usePublishDestination, useRollbackDestination,
  useDestinationVersions, useSetDestinationArchived, useDestinationHotels,
  hasUnpublishedDestinationChanges, isValidLocaleTag,
  DESTINATION_TYPES, SOURCE_TYPES, VERIFICATION_STATUSES,
  type Destination, type DestinationType, type ContentSourceType, type VerificationStatus,
} from "@/data/platform-destinations";
import { usePlatformStats } from "@/data/platform";
import { usePlatform } from "@/providers/platform-provider";
import { StatusBadge, VerificationBadge } from "@/components/platform/destination-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogClose } from "@/components/ui/dialog";

const LABEL = "block text-[12px] font-medium text-ink-secondary";
const SELECT_CLS = "w-full appearance-none rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2 text-sm text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2";
const TEXTAREA_CLS = "w-full rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2 text-sm text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2";

type Form = {
  name: string; slug: string; country_code: string; region: string;
  destination_type: DestinationType; timezone: string; default_locale: string; supported_locales: string;
  latitude: string; longitude: string; short_description: string; seo_title: string; seo_description: string;
  source_type: ContentSourceType; source_name: string; source_url: string;
  last_verified_at: string; verification_status: VerificationStatus; rights_notes: string;
};

function toForm(d: Destination): Form {
  return {
    name: d.name ?? "", slug: d.slug ?? "", country_code: d.country_code ?? "", region: d.region ?? "",
    destination_type: d.destination_type, timezone: d.timezone ?? "", default_locale: d.default_locale ?? "",
    supported_locales: (d.supported_locales ?? []).join(", "),
    latitude: d.latitude?.toString() ?? "", longitude: d.longitude?.toString() ?? "",
    short_description: d.short_description ?? "", seo_title: d.seo_title ?? "", seo_description: d.seo_description ?? "",
    source_type: d.source_type, source_name: d.source_name ?? "", source_url: d.source_url ?? "",
    last_verified_at: d.last_verified_at ? d.last_verified_at.slice(0, 10) : "",
    verification_status: d.verification_status, rights_notes: d.rights_notes ?? "",
  };
}

export default function DestinationEditorPage() {
  const params = useParams();
  const id = Array.isArray(params.destinationId) ? params.destinationId[0] : (params.destinationId as string);
  const router = useRouter();
  const { setDestination } = usePlatform();

  const { data: dest, isLoading, isError, error } = useDestination(id);
  const { data: stats } = usePlatformStats(id);
  const { data: hotels = [] } = useDestinationHotels(id);
  const update = useUpdateDestination();
  const publish = usePublishDestination();
  const archive = useSetDestinationArchived();

  const [form, setForm] = React.useState<Form | null>(null);
  const [changeSummary, setChangeSummary] = React.useState("");
  const [preview, setPreview] = React.useState<"draft" | "live">("draft");
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);

  // Sync form + set platform context to this destination (switcher + banner integration).
  // Re-sync on id AND updated_at so a publish/rollback/save refetch reflects the new
  // server state in the fields (not just the badges). During editing the server row
  // is unchanged, so in-progress edits are never clobbered.
  React.useEffect(() => { if (dest) setForm(toForm(dest)); }, [dest?.id, dest?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (dest?.id && dest.status !== "archived") setDestination(dest.id); }, [dest?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  if (isError) return <ErrorState message={(error as any)?.message} />;
  if (!isLoading && !dest) return <ErrorState message="This destination doesn’t exist or was removed." />;
  if (isLoading || !dest || !form) return <LoadingState />;

  const localeTags = form.supported_locales.split(",").map((s) => s.trim()).filter(Boolean);
  const badLocales = [form.default_locale, ...localeTags].filter((l) => l && !isValidLocaleTag(l));
  const slugValid = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(form.slug);
  const latNum = form.latitude.trim() === "" ? null : Number(form.latitude);
  const lngNum = form.longitude.trim() === "" ? null : Number(form.longitude);
  const coordsValid =
    (latNum === null || (!Number.isNaN(latNum) && latNum >= -90 && latNum <= 90)) &&
    (lngNum === null || (!Number.isNaN(lngNum) && lngNum >= -180 && lngNum <= 180));
  const canSave = form.name.trim().length >= 2 && slugValid && !!form.timezone.trim() && badLocales.length === 0 && coordsValid;

  const patch = () => ({
    name: form.name.trim(), slug: form.slug.trim(),
    country_code: form.country_code.trim().toUpperCase() || null,
    region: form.region.trim() || null,
    destination_type: form.destination_type, timezone: form.timezone.trim(),
    default_locale: form.default_locale.trim(),
    supported_locales: localeTags.length ? localeTags : [form.default_locale.trim()],
    latitude: latNum, longitude: lngNum,
    short_description: form.short_description.trim() || null,
    seo_title: form.seo_title.trim() || null, seo_description: form.seo_description.trim() || null,
    source_type: form.source_type, source_name: form.source_name.trim() || null, source_url: form.source_url.trim() || null,
    last_verified_at: form.last_verified_at ? new Date(form.last_verified_at).toISOString() : null,
    verification_status: form.verification_status, rights_notes: form.rights_notes.trim() || null,
  });

  async function saveDraft() {
    setMsg(null);
    try { await update.mutateAsync({ id, patch: patch() }); setMsg({ tone: "ok", text: "Draft saved." }); }
    catch (e: any) { setMsg({ tone: "err", text: e?.code === "23505" ? "Slug already taken." : (e?.message ?? "Save failed.") }); }
  }
  async function doPublish() {
    setMsg(null);
    try {
      if (canSave) await update.mutateAsync({ id, patch: patch() });   // persist current draft first
      await publish.mutateAsync({ id, changeSummary: changeSummary.trim() || undefined });
      setChangeSummary(""); setMsg({ tone: "ok", text: "Published — live for all hotels in this destination." });
    } catch (e: any) { setMsg({ tone: "err", text: e?.message ?? "Publish failed." }); }
  }
  async function toggleArchive() {
    setMsg(null);
    const archived = dest!.status !== "archived";
    try { await archive.mutateAsync({ id, archived }); setMsg({ tone: "ok", text: archived ? "Destination archived." : "Destination restored to draft." }); }
    catch (e: any) { setMsg({ tone: "err", text: e?.message ?? "Action failed." }); }
  }

  const unpublished = hasUnpublishedDestinationChanges(dest);
  const live = (dest.published_snapshot ?? null) as any;
  const busy = update.isPending || publish.isPending || archive.isPending;

  // Warnings
  const warnings: string[] = [];
  if (dest.status === "draft") warnings.push("Not yet published — hotels can’t see this destination.");
  if (!form.short_description.trim()) warnings.push("No short description.");
  if (latNum === null || lngNum === null) warnings.push("Coordinates incomplete.");
  if (form.source_type !== "manual" && !form.source_url.trim()) warnings.push("Non-manual source has no source URL/reference.");
  if (form.verification_status !== "verified") warnings.push(`Verification status is “${form.verification_status}”.`);
  if (unpublished) warnings.push("Draft has unpublished changes.");

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href="/platform/destinations" className="inline-flex items-center gap-1.5 text-[13px] text-ink-tertiary hover:text-ink-primary">
            <ArrowLeft className="h-4 w-4" /> Destinations
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold text-ink-primary">{form.name || "Untitled"}</h1>
            <StatusBadge status={dest.status} />
            <VerificationBadge status={dest.verification_status} />
            {unpublished && <span className="rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">unpublished changes</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HistoryDialog id={id} />
          <Button variant="ghost" size="sm" onClick={toggleArchive} disabled={busy}>
            {dest.status === "archived" ? <><ArchiveRestore className="h-4 w-4" /> Restore</> : <><Archive className="h-4 w-4" /> Archive</>}
          </Button>
          <Button variant="secondary" size="sm" onClick={saveDraft} disabled={!canSave || busy}>
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft
          </Button>
        </div>
      </div>

      {msg && (
        <p className={`rounded-md px-3 py-2 text-[13px] ${msg.tone === "ok" ? "bg-success-soft/50 text-success" : "bg-danger-soft/50 text-danger"}`}>{msg.text}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* LEFT — fields */}
        <div className="space-y-4">
          <Section icon={MapPin} title="Identity">
            <Grid>
              <Field label="Name"><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label="Slug" hint={slugValid ? undefined : "lowercase-hyphenated"}>
                <Input value={form.slug} onChange={(e) => set("slug", e.target.value)} aria-invalid={!slugValid} />
              </Field>
              <Field label="Country (ISO-2)"><Input value={form.country_code} maxLength={2} onChange={(e) => set("country_code", e.target.value.toUpperCase().slice(0, 2))} /></Field>
              <Field label="Region (optional)"><Input value={form.region} onChange={(e) => set("region", e.target.value)} /></Field>
              <Field label="Type">
                <select className={SELECT_CLS} value={form.destination_type} onChange={(e) => set("destination_type", e.target.value as DestinationType)}>
                  {DESTINATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Timezone"><Input value={form.timezone} onChange={(e) => set("timezone", e.target.value)} /></Field>
            </Grid>
            <Field label="Short description">
              <textarea className={TEXTAREA_CLS} rows={2} value={form.short_description} onChange={(e) => set("short_description", e.target.value)} />
            </Field>
          </Section>

          <Section icon={Globe} title="Locales">
            <Grid>
              <Field label="Canonical locale" hint={isValidLocaleTag(form.default_locale) ? undefined : "e.g. en / en-gb"}>
                <Input value={form.default_locale} onChange={(e) => set("default_locale", e.target.value.toLowerCase())} aria-invalid={!isValidLocaleTag(form.default_locale)} />
              </Field>
              <Field label="Supported locales (comma-separated)" hint={badLocales.length ? `invalid: ${badLocales.join(", ")}` : undefined}>
                <Input value={form.supported_locales} onChange={(e) => set("supported_locales", e.target.value.toLowerCase())} placeholder="en, hr, de" />
              </Field>
            </Grid>
          </Section>

          <Section icon={MapPin} title="Coordinates">
            <Grid>
              <Field label="Latitude" hint={coordsValid ? undefined : "−90…90"}><Input value={form.latitude} onChange={(e) => set("latitude", e.target.value)} inputMode="decimal" /></Field>
              <Field label="Longitude" hint={coordsValid ? undefined : "−180…180"}><Input value={form.longitude} onChange={(e) => set("longitude", e.target.value)} inputMode="decimal" /></Field>
            </Grid>
          </Section>

          <Section icon={SearchIcon} title="SEO">
            <Field label="SEO title"><Input value={form.seo_title} onChange={(e) => set("seo_title", e.target.value)} /></Field>
            <Field label="SEO description">
              <textarea className={TEXTAREA_CLS} rows={2} value={form.seo_description} onChange={(e) => set("seo_description", e.target.value)} />
            </Field>
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
              <Field label="Rights notes"><Input value={form.rights_notes} onChange={(e) => set("rights_notes", e.target.value)} /></Field>
            </Grid>
          </Section>
        </div>

        {/* RIGHT — preview / publishing / summary / hotels / warnings */}
        <div className="space-y-4">
          <Section icon={Eye} title="Preview" action={
            <div className="flex overflow-hidden rounded-md border border-border-subtle text-[11px]">
              <button onClick={() => setPreview("draft")} className={`px-2 py-1 ${preview === "draft" ? "bg-brand-navy/60 text-ink-primary" : "text-ink-tertiary"}`}>Draft</button>
              <button onClick={() => setPreview("live")} disabled={!live} className={`px-2 py-1 ${preview === "live" ? "bg-brand-navy/60 text-ink-primary" : "text-ink-tertiary"} disabled:opacity-40`}>Live</button>
            </div>
          }>
            <GuestPreview src={preview === "live" && live ? live : patch()} isLive={preview === "live"} liveMissing={preview === "live" && !live} />
          </Section>

          <Section icon={UploadCloud} title="Publishing">
            <p className="text-[12px] text-ink-tertiary">
              Publishing pushes the current draft live for <span className="font-medium text-ink-secondary">all {stats?.hotels ?? hotels.length} hotel(s)</span> in this destination.
            </p>
            <textarea className={TEXTAREA_CLS} rows={2} placeholder="Change summary (optional)" value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} />
            <Button variant="primary" size="sm" className="w-full" onClick={doPublish} disabled={busy || !canSave}>
              {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Publish destination
            </Button>
            {dest.published_at && <p className="text-[11px] text-ink-tertiary">Last published {new Date(dest.published_at).toLocaleString()}</p>}
          </Section>

          <Section icon={Landmark} title="Content summary">
            <div className="grid grid-cols-2 gap-2 text-[13px]">
              <Count icon={Building2} label="Hotels" n={stats?.hotels ?? hotels.length} />
              <Count icon={Landmark} label="POIs" n={stats?.pois ?? 0} />
              <Count icon={Route} label="Routes" n={stats?.routes ?? 0} />
              <Count icon={Sparkles} label="Whispers" n={stats?.whispers ?? 0} />
              <Count icon={CalendarDays} label="Events" n={stats?.events ?? 0} />
            </div>
          </Section>

          <Section icon={Building2} title={`Linked hotels (${hotels.length})`}>
            {hotels.length === 0 ? (
              <p className="text-[12px] text-ink-tertiary">No hotels linked yet.</p>
            ) : (
              <ul className="space-y-1">{hotels.map((h) => <li key={h.id} className="truncate text-[13px] text-ink-secondary">{h.name}</li>)}</ul>
            )}
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
  return (
    <div className="space-y-1">
      <label className={LABEL}>{label}</label>
      {children}
      {hint && <p className="text-[11px] text-warning">{hint}</p>}
    </div>
  );
}
function Count({ icon: Icon, label, n }: { icon: any; label: string; n: number }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2">
      <Icon className="h-4 w-4 text-ink-tertiary" />
      <span className="text-ink-secondary">{label}</span>
      <span className="ml-auto font-semibold text-ink-primary">{n}</span>
    </div>
  );
}
function GuestPreview({ src, isLive, liveMissing }: { src: any; isLive: boolean; liveMissing: boolean }) {
  if (liveMissing) return <p className="text-[12px] text-ink-tertiary">No live version yet — publish to create one.</p>;
  const typeLabel = DESTINATION_TYPES.find((t) => t.value === src.destination_type)?.label ?? src.destination_type;
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken p-3">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-tertiary">{isLive ? "Live (published)" : "Draft"}</div>
      <div className="text-base font-semibold text-ink-primary">{src.name || "Untitled"}</div>
      <div className="text-[12px] text-ink-tertiary">{[src.country_code, src.region, typeLabel].filter(Boolean).join(" · ")}</div>
      {src.short_description && <p className="mt-2 text-[13px] text-ink-secondary">{src.short_description}</p>}
      <div className="mt-2 text-[11px] text-ink-tertiary">
        {src.default_locale && <>locale {src.default_locale} · </>}
        {(src.latitude ?? null) !== null && (src.longitude ?? null) !== null ? <>{Number(src.latitude).toFixed(3)}, {Number(src.longitude).toFixed(3)}</> : "no coordinates"}
      </div>
    </div>
  );
}

function HistoryDialog({ id }: { id: string }) {
  const { data: versions = [], isLoading } = useDestinationVersions(id);
  const rollback = useRollbackDestination();
  const [busyV, setBusyV] = React.useState<string | null>(null);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><History className="h-4 w-4" /> History</Button>
      </DialogTrigger>
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
                  <div className="text-[11px] text-ink-tertiary">{v.published_at ? new Date(v.published_at).toLocaleString() : new Date(v.created_at).toLocaleString()}</div>
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
        <p className="mt-2 text-sm text-ink-secondary">Couldn’t load this destination. {message}</p>
        <Button asChild variant="secondary" size="sm" className="mt-3"><Link href="/platform/destinations">Back to destinations</Link></Button>
      </div>
    </div>
  );
}
