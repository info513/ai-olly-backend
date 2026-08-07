"use client";

import * as React from "react";
import { ShieldCheck, Star, EyeOff, Eye, RotateCcw, Save, Search, Sparkles, AlertTriangle, ChevronDown } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import {
  useHotelPresentation, useUpsertPresentationSettings, useResetPresentationSettings,
  PRES_ENTITIES, type PresEntity, type PresRow, type SettingsPatch,
} from "@/data/hotel-presentation";
import { humanizeError } from "@/data/errors";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleField, NumberField, TextField, TextAreaField } from "@/components/content/fields";
import { cn } from "@/lib/utils";

/** The standing message every Presentation surface shows: canonical facts belong
 *  to the platform; the hotel only controls how shared content is presented. */
export function PlatformMaintainedBanner() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-brand-goldDeep/30 bg-brand-navy/30 px-4 py-3">
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-cream" />
      <div className="text-[13px]">
        <div className="font-medium text-ink-primary">Maintained by AI OLLY Platform</div>
        <div className="text-ink-tertiary">Your hotel controls presentation only — visibility, featuring, order, and your own notes. The underlying facts are shared destination content and can’t be edited here.</div>
      </div>
    </div>
  );
}

const LABELS: Record<PresEntity, { title: string; blurb: string; icon: React.ReactNode }> = {
  poi:     { title: "Points of interest", blurb: "Choose which nearby places your guests see, and add your own recommendation.", icon: <Sparkles className="h-5 w-5" /> },
  route:   { title: "Routes",             blurb: "Curate the walks and routes your guests see, and add your own notes.", icon: <Sparkles className="h-5 w-5" /> },
  whisper: { title: "Whispers",           blurb: "Curate the destination story chapters shown to your guests.", icon: <Sparkles className="h-5 w-5" /> },
  event:   { title: "Events",             blurb: "Curate which local events your guests see, and add your own note.", icon: <Sparkles className="h-5 w-5" /> },
};

export function PresentationManager({ entity }: { entity: PresEntity }) {
  const { currentHotel } = useHotel();
  const { role, isPlatformAdmin } = usePermissions();
  const mayEdit = isPlatformAdmin || role === "hotel_admin" || role === "editor";
  const q = useHotelPresentation(entity, currentHotel?.id);

  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<"all" | "visible" | "hidden" | "featured" | "customized">("all");
  const meta = LABELS[entity];

  const rows = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return (q.data ?? []).filter((r) => {
      if (filter === "visible" && !r.visible) return false;
      if (filter === "hidden" && r.visible) return false;
      if (filter === "featured" && !r.featured) return false;
      if (filter === "customized" && !r.hasSettings) return false;
      if (term && !`${r.title} ${r.key} ${r.group ?? ""}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [q.data, search, filter]);

  // group whispers by channel; others flat
  const groups = React.useMemo(() => {
    if (entity !== "whisper") return [["", rows]] as [string, PresRow[]][];
    const m = new Map<string, PresRow[]>();
    for (const r of rows) { const k = r.group ?? "—"; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
    return [...m.entries()];
  }, [rows, entity]);

  const FILTERS = [
    { k: "all", label: "All" }, { k: "visible", label: "Shown" }, { k: "hidden", label: "Hidden" },
    { k: "featured", label: "Featured" }, { k: "customized", label: "Customized" },
  ] as const;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-primary">{meta.title}</h1>
        <p className="mt-1 text-sm text-ink-tertiary">{meta.blurb}</p>
      </header>

      <PlatformMaintainedBanner />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-8" aria-label="Search" />
        </div>
        <div className="inline-flex rounded-md border border-border-strong bg-surface-sunken p-0.5">
          {FILTERS.map((f) => (
            <button key={f.k} onClick={() => setFilter(f.k)} className={cn("rounded px-2.5 py-1 text-[12px] font-medium transition-colors", filter === f.k ? "bg-brand-navy text-brand-creamSoft" : "text-ink-tertiary hover:text-ink-secondary")}>{f.label}</button>
          ))}
        </div>
      </div>

      {!mayEdit && (
        <div className="rounded-lg border border-border-subtle bg-surface-base px-4 py-3 text-[13px] text-ink-tertiary">Your role can view how shared content is presented but not change it. Hotel admins and editors manage presentation.</div>
      )}

      {q.isError ? (
        <div className="rounded-xl border border-danger/30 bg-danger-soft/40 p-6 text-center"><AlertTriangle className="mx-auto h-6 w-6 text-danger" /><p className="mt-2 text-sm text-ink-secondary">Couldn’t load content. {(q.error as any)?.message}</p><Button variant="secondary" size="sm" className="mt-3" onClick={() => q.refetch()}>Retry</Button></div>
      ) : q.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[72px] w-full rounded-lg" />)}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-raised p-10 text-center"><span className="mx-auto flex h-7 w-7 items-center justify-center text-ink-tertiary">{meta.icon}</span><p className="mt-3 text-sm font-medium text-ink-secondary">{q.data?.length ? "No items match these filters." : "No shared content for your destination yet."}</p></div>
      ) : (
        <div className="space-y-5">
          {groups.map(([g, items]) => (
            <section key={g || "flat"}>
              {g && <h2 className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-ink-tertiary">{g} <span className="text-ink-tertiary/60">· {items.length}</span></h2>}
              <ul className="space-y-2.5">
                {items.map((r) => <PresentationRow key={r.entityId} entity={entity} row={r} hotelId={currentHotel?.id} mayEdit={mayEdit} />)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function PresentationRow({ entity, row, hotelId, mayEdit }: { entity: PresEntity; row: PresRow; hotelId?: string; mayEdit: boolean }) {
  const supports = PRES_ENTITIES[entity].supports;
  const upsert = useUpsertPresentationSettings(entity, hotelId);
  const reset = useResetPresentationSettings(entity, hotelId);
  const [open, setOpen] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // local draft of the editable text/number fields (toggles save immediately)
  const [order, setOrder] = React.useState<number | null>(row.sortOrderOverride);
  const [rec, setRec] = React.useState(row.hotelRecommendation ?? "");
  const [intro, setIntro] = React.useState(row.hotelShortDescription ?? "");
  const [walk, setWalk] = React.useState<number | null>(row.walkingTimeMinutes);
  const [photo, setPhoto] = React.useState(row.hotelPhotoUrl ?? "");
  React.useEffect(() => {
    setOrder(row.sortOrderOverride); setRec(row.hotelRecommendation ?? ""); setIntro(row.hotelShortDescription ?? "");
    setWalk(row.walkingTimeMinutes); setPhoto(row.hotelPhotoUrl ?? "");
  }, [row.entityId, row.sortOrderOverride, row.hotelRecommendation, row.hotelShortDescription, row.walkingTimeMinutes, row.hotelPhotoUrl]);

  const dirty =
    order !== row.sortOrderOverride ||
    (rec || null) !== (row.hotelRecommendation ?? null) ||
    (supports.shortDescription && (intro || null) !== (row.hotelShortDescription ?? null)) ||
    (supports.walkingTime && walk !== row.walkingTimeMinutes) ||
    (supports.photo && (photo || null) !== (row.hotelPhotoUrl ?? null));

  const run = async (patch: SettingsPatch) => {
    setErr(null);
    try { await upsert.mutateAsync({ entityId: row.entityId, patch }); }
    catch (e) { setErr(humanizeError(e)); }
  };
  const saveFields = () => {
    const patch: SettingsPatch = { sort_order_override: order, hotel_recommendation: rec.trim() || null };
    if (supports.shortDescription) patch.hotel_short_description = intro.trim() || null;
    if (supports.walkingTime) patch.walking_time_minutes = walk;
    if (supports.photo) patch.hotel_photo_url = photo.trim() || null;
    run(patch);
  };
  const doReset = async () => { setErr(null); try { await reset.mutateAsync(row.entityId); setOpen(false); } catch (e) { setErr(humanizeError(e)); } };

  return (
    <li>
      <Card className={cn("overflow-hidden", !row.visible && "opacity-70")}>
        <div className="flex flex-col gap-3 p-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-ink-primary">{row.title}</span>
              {row.featured && <Badge tone="brand" className="gap-1"><Star className="h-3 w-3" /> Featured</Badge>}
              {!row.visible && <Badge tone="neutral" className="gap-1"><EyeOff className="h-3 w-3" /> Hidden</Badge>}
              {row.hasSettings && <span className="text-[11px] text-ink-tertiary">customized</span>}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink-tertiary">
              {row.facts.slice(0, 3).map((f) => <span key={f.label}><span className="text-ink-tertiary/70">{f.label}:</span> {f.value}</span>)}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" disabled={!mayEdit || upsert.isPending} onClick={() => run({ visible: !row.visible })}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition disabled:opacity-50", row.visible ? "border-border-strong text-ink-secondary hover:text-ink-primary" : "border-brand-goldDeep/50 bg-brand-navy/40 text-brand-cream")}
              title={row.visible ? "Hide from guests" : "Show to guests"}>
              {row.visible ? <><Eye className="h-3.5 w-3.5" /> Shown</> : <><EyeOff className="h-3.5 w-3.5" /> Hidden</>}
            </button>
            <button type="button" disabled={!mayEdit || upsert.isPending} onClick={() => run({ featured: !row.featured })}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition disabled:opacity-50", row.featured ? "border-brand-goldDeep/50 bg-brand-navy/40 text-brand-cream" : "border-border-strong text-ink-secondary hover:text-ink-primary")}
              title={row.featured ? "Unfeature" : "Feature"}>
              <Star className={cn("h-3.5 w-3.5", row.featured && "fill-current")} /> Feature
            </button>
            <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-ink-tertiary hover:text-ink-primary">
              Presentation <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
            </button>
          </div>
        </div>

        {open && (
          <div className="border-t border-border-subtle bg-surface-base/40 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              {/* Canonical facts — read-only */}
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary"><ShieldCheck className="h-3.5 w-3.5" /> Maintained by AI OLLY Platform</div>
                <dl className="space-y-1.5 text-[13px]">
                  <div className="flex justify-between gap-3"><dt className="text-ink-tertiary">Key</dt><dd className="truncate font-mono text-[11px] text-ink-secondary">{row.key}</dd></div>
                  {row.facts.map((f) => <div key={f.label} className="flex justify-between gap-3"><dt className="text-ink-tertiary">{f.label}</dt><dd className="min-w-0 text-right text-ink-primary">{f.value}</dd></div>)}
                  <div className="flex justify-between gap-3"><dt className="text-ink-tertiary">Default order</dt><dd className="text-ink-secondary">{row.canonicalSortOrder ?? "—"}</dd></div>
                </dl>
                <p className="mt-2 text-[11px] text-ink-tertiary">These facts are shared destination content. Your hotel controls presentation only.</p>
              </div>

              {/* Hotel presentation controls */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <ToggleField label="Visible to guests" checked={row.visible} onChange={(v) => run({ visible: v })} disabled={!mayEdit} />
                  <ToggleField label="Featured" checked={row.featured} onChange={(v) => run({ featured: v })} disabled={!mayEdit} />
                </div>
                <div className={cn("grid gap-2", supports.walkingTime ? "grid-cols-2" : "grid-cols-1")}>
                  <NumberField label="Display order" hint="overrides default" value={order} onChange={setOrder} disabled={!mayEdit} />
                  {supports.walkingTime && <NumberField label="Walking time (min)" value={walk} onChange={setWalk} disabled={!mayEdit} />}
                </div>
                <TextAreaField label="Your recommendation" hint="shown to your guests" value={rec} onChange={setRec} rows={2} disabled={!mayEdit} placeholder="Why your guests should visit…" />
                {supports.shortDescription && <TextAreaField label="Your short intro" value={intro} onChange={setIntro} rows={2} disabled={!mayEdit} placeholder="A hotel-specific intro (optional)" />}
                {supports.photo && <TextField label="Image override URL" hint="your own photo (optional)" value={photo} onChange={setPhoto} disabled={!mayEdit} placeholder="https://…" />}

                {err && <p className="text-[12px] text-danger">{err}</p>}
                {mayEdit && (
                  <div className="flex items-center justify-between gap-2">
                    <button onClick={doReset} disabled={!row.hasSettings || reset.isPending} className="inline-flex items-center gap-1 text-[12px] text-ink-tertiary hover:text-danger disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" /> Reset to platform default</button>
                    <Button variant="secondary" size="sm" onClick={saveFields} loading={upsert.isPending} disabled={!dirty}><Save className="h-4 w-4" /> Save</Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>
    </li>
  );
}
