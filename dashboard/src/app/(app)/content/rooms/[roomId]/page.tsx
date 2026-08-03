"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Save, Eye } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useRoom, useRoomType, useResolvedRoom, useUpdateRoom } from "@/data/rooms";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, PermissionDenied } from "@/components/content/states";
import { ResolvedRoomPanel } from "@/components/content/resolved-room-panel";
import { ThreeStateBoolField, InheritTextField, ToggleField, NumberField, TextAreaField } from "@/components/content/fields";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Room } from "@/data/types";

export default function RoomEditor() {
  const { roomId } = useParams<{ roomId: string }>();
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const mayContent = role === "platform_admin" || role === "hotel_admin" || role === "editor";
  const mayOps = role === "platform_admin" || role === "hotel_admin";

  const roomQ = useRoom(roomId);
  const typeQ = useRoomType(roomQ.data?.room_type_id);
  const resolvedQ = useResolvedRoom(roomId);
  const update = useUpdateRoom(currentHotel?.id);

  const [form, setForm] = React.useState<Partial<Room>>({});
  const [dirty, setDirty] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => { if (roomQ.data) { setForm(roomQ.data); setDirty(false); } }, [roomQ.data]);

  const set = <K extends keyof Room>(k: K, v: Room[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); setSaved(false); };

  const save = async () => {
    setSaveError(null);
    const patch: Partial<Room> = {
      capacity_override: form.capacity_override ?? null,
      bed_configuration_override: form.bed_configuration_override ?? null,
      view_description_override: form.view_description_override ?? null,
      smart_glass_override: form.smart_glass_override ?? null,
      smart_glass_instructions_override: form.smart_glass_instructions_override ?? null,
      window_mode_override: form.window_mode_override ?? null,
      underfloor_heating_override: form.underfloor_heating_override ?? null,
      air_conditioning_note_override: form.air_conditioning_note_override ?? null,
      extra_bed_available_override: form.extra_bed_available_override ?? null,
      ai_welcome_override: form.ai_welcome_override ?? null,
    };
    if (mayOps) { patch.floor = form.floor ?? null; patch.active = form.active; }
    try {
      await update.mutateAsync({ id: roomId, patch });
      setDirty(false); setSaved(true);
    } catch (e) { setSaveError(humanizeError(e)); }
  };

  if (roomQ.isError) return <div className="mx-auto max-w-[1100px] p-6"><ErrorState error={roomQ.error} onRetry={() => roomQ.refetch()} /></div>;
  if (roomQ.isLoading || typeQ.isLoading) return <div className="mx-auto max-w-[1100px] p-6"><SectionLoader rows={6} /></div>;

  const t = typeQ.data;
  const dis = !mayContent;

  return (
    <div className="mx-auto max-w-[1100px] p-6 pb-24">
      <PageHeader
        crumbs={[{ label: "Content", href: "/content" }, { label: "Rooms", href: "/content/rooms" }, { label: `Room ${roomQ.data?.room_number}` }]}
        title={`Room ${roomQ.data?.room_number}`}
        subtitle={`${t?.name ?? ""} · overrides shown against room-type defaults`}
        backHref="/content/rooms"
      />

      {dis && <div className="mb-4"><PermissionDenied message="Your role can view this room but not change it." /></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Left — overrides */}
        <div className="space-y-4">
          {mayOps && (
            <Card className="p-5">
              <h2 className="mb-4 text-[13px] font-semibold text-ink-primary">Operational</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField label="Floor" value={form.floor ?? null} onChange={(v) => set("floor", v)} />
                <div className="flex items-end"><div className="w-full"><ToggleField label="Active" checked={!!form.active} onChange={(v) => set("active", v)} /></div></div>
              </div>
              <p className="mt-3 text-[11px] text-ink-tertiary">Room number, type and access token are fixed and never shown here.</p>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-1 text-[13px] font-semibold text-ink-primary">Room overrides</h2>
            <p className="mb-4 text-[12px] text-ink-tertiary">Leave on “Inherit” to follow the room type. Overrides win for this room only.</p>
            <div className="space-y-3">
              <ThreeStateBoolField label="Smart glass" value={form.smart_glass_override ?? null} inherited={t?.smart_glass ?? null} onChange={(v) => set("smart_glass_override", v)} disabled={dis} />
              <ThreeStateBoolField label="Underfloor heating" value={form.underfloor_heating_override ?? null} inherited={t?.underfloor_heating ?? null} onChange={(v) => set("underfloor_heating_override", v)} disabled={dis} />
              <ThreeStateBoolField label="Extra bed available" value={form.extra_bed_available_override ?? null} inherited={t?.default_extra_bed_available ?? null} onChange={(v) => set("extra_bed_available_override", v)} disabled={dis} />

              <div className="rounded-md border border-border-subtle bg-surface-base p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Capacity</label>
                  {form.capacity_override != null ? (
                    <button disabled={dis} onClick={() => set("capacity_override", null)} className="text-[11px] text-ink-tertiary hover:text-brand-cream disabled:opacity-50">Use default ({t?.default_capacity ?? "—"})</button>
                  ) : (
                    <button disabled={dis} onClick={() => set("capacity_override", t?.default_capacity ?? 2)} className="text-[11px] text-ink-tertiary hover:text-brand-cream disabled:opacity-50">Override</button>
                  )}
                </div>
                {form.capacity_override != null ? (
                  <NumberField label="" value={form.capacity_override} onChange={(v) => set("capacity_override", v)} disabled={dis} />
                ) : (
                  <p className="rounded-md bg-surface-sunken px-3 py-2 text-[13px] text-ink-tertiary">{t?.default_capacity ?? "—"} <span className="ml-2 text-[11px] uppercase tracking-wide text-ink-tertiary/60">inherited</span></p>
                )}
              </div>

              <InheritTextField label="Bed configuration" value={form.bed_configuration_override ?? null} inherited={t?.default_bed_configuration ?? null} onChange={(v) => set("bed_configuration_override", v)} disabled={dis} />
              <InheritTextField label="Smart glass how-to" value={form.smart_glass_instructions_override ?? null} inherited={t?.smart_glass_instructions ?? null} onChange={(v) => set("smart_glass_instructions_override", v)} disabled={dis} />
              <InheritTextField label="Window" value={form.window_mode_override ?? null} inherited={t?.window_instructions ?? null} onChange={(v) => set("window_mode_override", v)} disabled={dis} />
              <InheritTextField label="Air conditioning note" value={form.air_conditioning_note_override ?? null} inherited={t?.ac_instructions ?? null} onChange={(v) => set("air_conditioning_note_override", v)} disabled={dis} />
              <InheritTextField label="AI welcome" value={form.ai_welcome_override ?? null} inherited={t?.ai_welcome ?? null} onChange={(v) => set("ai_welcome_override", v)} disabled={dis} />

              <TextAreaField label="View (room-specific)" value={form.view_description_override ?? ""} onChange={(v) => set("view_description_override", v || null)} disabled={dis} hint="unique to this room; empty = none" rows={2} />
            </div>
          </Card>
        </div>

        {/* Right — resolved preview */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">
              <Eye className="h-4 w-4" /> Resolved guest view
            </div>
            {resolvedQ.data ? (
              <ResolvedRoomPanel resolved={resolvedQ.data} room={form as Room} />
            ) : (
              <SectionLoader rows={6} />
            )}
            <p className="mt-3 text-[11px] text-ink-tertiary">Preview only — the guest app is not affected.</p>
          </Card>
        </div>
      </div>

      {mayContent && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border-subtle bg-surface-base/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1100px] items-center justify-between px-6 py-3">
            <span className="text-[12px] text-ink-tertiary">
              {saveError ? <span className="text-danger">{saveError}</span> : dirty ? "Unsaved changes" : saved ? <span className="text-success">Saved</span> : "All changes saved"}
            </span>
            <Button variant="primary" onClick={save} loading={update.isPending} disabled={!dirty}>
              <Save className="h-4 w-4" /> Save room
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
