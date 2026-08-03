"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Save, Layers } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useRoomType, useUpsertRoomType } from "@/data/rooms";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, PermissionDenied } from "@/components/content/states";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TextField, TextAreaField, NumberField, ToggleField, TagsField } from "@/components/content/fields";
import type { RoomType } from "@/data/types";

const canEditRole = (role: string | null) => role === "platform_admin" || role === "hotel_admin" || role === "editor";

const BLANK: Partial<RoomType> = {
  name: "", slug: "", description: "", active: true, sort_order: 0, default_capacity: 2,
  default_bed_configuration: "", wifi_instructions: "", ac_instructions: "", tv_instructions: "",
  safe_instructions: "", smart_glass: false, smart_glass_instructions: "", window_instructions: "",
  underfloor_heating: false, room_features: [], room_notes: [], ai_welcome: "", minibar_available: false,
  kettle_available: false, blackout_system: false, toiletries: "",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-[13px] font-semibold text-ink-primary">{title}</h2>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

export default function RoomTypeEditor() {
  const { typeId } = useParams<{ typeId: string }>();
  const isNew = typeId === "new";
  const router = useRouter();
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const mayEdit = canEditRole(role);

  const { data, isLoading, isError, error, refetch } = useRoomType(isNew ? undefined : typeId);
  const upsert = useUpsertRoomType(currentHotel?.id);

  const [form, setForm] = React.useState<Partial<RoomType>>(BLANK);
  const [dirty, setDirty] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => { if (data) { setForm(data); setDirty(false); } }, [data]);
  React.useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const set = <K extends keyof RoomType>(k: K, v: RoomType[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); setSaved(false); };

  const save = async () => {
    setSaveError(null);
    try {
      const res = await upsert.mutateAsync({ id: isNew ? undefined : typeId, values: form });
      setDirty(false); setSaved(true);
      if (isNew) router.replace(`/content/rooms/types/${res.id}`);
    } catch (e) { setSaveError(humanizeError(e)); }
  };

  if (!isNew && isError) return <div className="mx-auto max-w-[900px] p-6"><ErrorState error={error} onRetry={() => refetch()} /></div>;
  if (!isNew && isLoading) return <div className="mx-auto max-w-[900px] p-6"><SectionLoader rows={6} /></div>;

  const dis = !mayEdit;

  return (
    <div className="mx-auto max-w-[900px] p-6 pb-24">
      <PageHeader
        crumbs={[{ label: "Content", href: "/content" }, { label: "Room types", href: "/content/rooms/types" }, { label: isNew ? "New" : form.name || "Room type" }]}
        title={isNew ? "New room type" : form.name || "Room type"}
        subtitle="Defaults every room of this type inherits."
        backHref="/content/rooms/types"
      />

      {dis && <div className="mb-4"><PermissionDenied message="Your role can view room types but not edit them." /></div>}

      <div className="space-y-4">
        <Section title="Basics">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Name" value={form.name ?? ""} onChange={(v) => set("name", v)} disabled={dis} placeholder="Deluxe" />
            <TextField label="Slug" value={form.slug ?? ""} onChange={(v) => set("slug", v)} disabled={dis} hint="lowercase-with-dashes" placeholder="deluxe" />
          </div>
          <TextAreaField label="Description" value={form.description ?? ""} onChange={(v) => set("description", v)} disabled={dis} />
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField label="Default capacity" value={form.default_capacity ?? null} onChange={(v) => set("default_capacity", v)} disabled={dis} />
            <TextField label="Bed configuration" value={form.default_bed_configuration ?? ""} onChange={(v) => set("default_bed_configuration", v)} disabled={dis} placeholder="King-size bed" />
            <NumberField label="Sort order" value={form.sort_order ?? 0} onChange={(v) => set("sort_order", v ?? 0)} disabled={dis} />
          </div>
          <ToggleField label="Active" description="Inactive types are hidden from new rooms." checked={!!form.active} onChange={(v) => set("active", v)} disabled={dis} />
        </Section>

        <Section title="Room Guide — instructions">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextAreaField label="Wi-Fi" value={form.wifi_instructions ?? ""} onChange={(v) => set("wifi_instructions", v)} disabled={dis} />
            <TextAreaField label="Air conditioning" value={form.ac_instructions ?? ""} onChange={(v) => set("ac_instructions", v)} disabled={dis} />
            <TextAreaField label="TV" value={form.tv_instructions ?? ""} onChange={(v) => set("tv_instructions", v)} disabled={dis} />
            <TextAreaField label="Safe" value={form.safe_instructions ?? ""} onChange={(v) => set("safe_instructions", v)} disabled={dis} />
            <TextAreaField label="Window" value={form.window_instructions ?? ""} onChange={(v) => set("window_instructions", v)} disabled={dis} />
            <TextAreaField label="Smart glass how-to" value={form.smart_glass_instructions ?? ""} onChange={(v) => set("smart_glass_instructions", v)} disabled={dis} />
          </div>
          <TextField label="Toiletries" value={form.toiletries ?? ""} onChange={(v) => set("toiletries", v)} disabled={dis} />
        </Section>

        <Section title="Room Guide — amenities">
          <div className="grid gap-3 sm:grid-cols-2">
            <ToggleField label="Smart glass" checked={!!form.smart_glass} onChange={(v) => set("smart_glass", v)} disabled={dis} />
            <ToggleField label="Underfloor heating" checked={!!form.underfloor_heating} onChange={(v) => set("underfloor_heating", v)} disabled={dis} />
            <ToggleField label="Minibar" checked={!!form.minibar_available} onChange={(v) => set("minibar_available", v)} disabled={dis} />
            <ToggleField label="Kettle" checked={!!form.kettle_available} onChange={(v) => set("kettle_available", v)} disabled={dis} />
            <ToggleField label="Blackout system" checked={!!form.blackout_system} onChange={(v) => set("blackout_system", v)} disabled={dis} />
          </div>
        </Section>

        <Section title="Content">
          <TagsField label="Features" value={form.room_features ?? []} onChange={(v) => set("room_features", v)} disabled={dis} />
          <TagsField label="Notes" value={form.room_notes ?? []} onChange={(v) => set("room_notes", v)} disabled={dis} />
          <TextAreaField label="AI welcome" value={form.ai_welcome ?? ""} onChange={(v) => set("ai_welcome", v)} disabled={dis} hint="What the AI says when a guest opens this room" />
        </Section>
      </div>

      {mayEdit && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border-subtle bg-surface-base/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-[900px] items-center justify-between px-6 py-3">
            <span className="text-[12px] text-ink-tertiary">
              {saveError ? <span className="text-danger">{saveError}</span> : dirty ? "Unsaved changes" : saved ? <span className="text-success">Saved</span> : "All changes saved"}
            </span>
            <Button variant="primary" onClick={save} loading={upsert.isPending} disabled={!dirty && !isNew}>
              <Save className="h-4 w-4" /> {isNew ? "Create room type" : "Save changes"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
