"use client";

import { cn } from "@/lib/utils";
import type { ResolvedRoom, Room } from "@/data/types";

function boolText(v: boolean | null) {
  return v === true ? "Yes" : v === false ? "No" : "—";
}
function listText(v: string[] | null) {
  return v && v.length ? v.join(", ") : "—";
}

/** A resolved-room row: effective value + inherited/override provenance. */
function Row({ label, value, overridden }: { label: string; value: React.ReactNode; overridden?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border-subtle py-2 last:border-0">
      <span className="text-[12px] text-ink-tertiary">{label}</span>
      <span className="flex min-w-0 flex-1 items-start justify-end gap-2 text-right">
        <span className="text-[13px] text-ink-primary">{value || "—"}</span>
        {overridden !== undefined && (
          <span
            className={cn(
              "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
              overridden ? "bg-brand-navySoft/50 text-brand-creamSoft" : "bg-surface-overlay text-ink-tertiary"
            )}
          >
            {overridden ? "override" : "inherited"}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * The effective guest-facing room context after inheritance (Part 5). Labels each
 * field as inherited from the room type or a room-specific override. Preview only.
 */
export function ResolvedRoomPanel({ resolved, room }: { resolved: ResolvedRoom; room?: Room | null }) {
  const ov = (k: keyof Room) => (room ? room[k] !== null && room[k] !== undefined : undefined);
  return (
    <div>
      <div className="mb-3">
        <div className="font-display text-[18px] text-ink-primary">Room {resolved.room_number}</div>
        <div className="text-[13px] text-ink-tertiary">{resolved.room_type_name}{resolved.floor != null ? ` · Floor ${resolved.floor}` : ""}</div>
      </div>
      <div className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-1">
        <Row label="Capacity" value={resolved.capacity ?? "—"} overridden={ov("capacity_override")} />
        <Row label="Bed" value={resolved.bed_configuration} overridden={ov("bed_configuration_override")} />
        <Row label="View" value={resolved.view_description} overridden={ov("view_description_override")} />
        <Row label="Smart glass" value={boolText(resolved.smart_glass)} overridden={ov("smart_glass_override")} />
        <Row label="Smart glass how-to" value={resolved.smart_glass_instructions} overridden={ov("smart_glass_instructions_override")} />
        <Row label="Window" value={resolved.window_instructions} overridden={ov("window_mode_override")} />
        <Row label="Underfloor heating" value={boolText(resolved.underfloor_heating)} overridden={ov("underfloor_heating_override")} />
        <Row label="Air conditioning" value={resolved.ac_instructions} overridden={ov("air_conditioning_note_override")} />
        <Row label="Extra bed" value={boolText(resolved.extra_bed_available)} overridden={ov("extra_bed_available_override")} />
        <Row label="Wi-Fi" value={resolved.wifi_instructions} overridden={false} />
        <Row label="TV" value={resolved.tv_instructions} overridden={false} />
        <Row label="Safe" value={resolved.safe_instructions} overridden={false} />
        <Row label="Minibar" value={boolText(resolved.minibar_available)} overridden={false} />
        <Row label="Kettle" value={boolText(resolved.kettle_available)} overridden={false} />
        <Row label="Blackout" value={boolText(resolved.blackout_system)} overridden={false} />
        <Row label="Toiletries" value={resolved.toiletries} overridden={false} />
        <Row label="Features" value={listText(resolved.room_features)} overridden={ov("room_features_override")} />
        <Row label="Notes" value={listText(resolved.room_notes)} overridden={ov("room_notes_override")} />
        <Row label="AI welcome" value={resolved.ai_welcome} overridden={ov("ai_welcome_override")} />
      </div>
    </div>
  );
}
