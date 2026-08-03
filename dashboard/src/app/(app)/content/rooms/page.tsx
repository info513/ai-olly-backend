"use client";

import * as React from "react";
import Link from "next/link";
import { Layers, ChevronRight } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useResolvedRooms, useRooms } from "@/data/rooms";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { relativeTime } from "@/lib/utils";
import type { Room } from "@/data/types";

const OVERRIDE_KEYS: (keyof Room)[] = [
  "capacity_override", "bed_configuration_override", "view_description_override", "smart_glass_override",
  "smart_glass_instructions_override", "window_mode_override", "underfloor_heating_override",
  "air_conditioning_note_override", "extra_bed_available_override", "room_features_override",
  "room_notes_override", "ai_welcome_override",
];
const overrideCount = (r: Room) => OVERRIDE_KEYS.filter((k) => r[k] !== null && r[k] !== undefined).length;
const boolText = (v: boolean | null) => (v === true ? "Yes" : v === false ? "No" : "—");

export default function RoomsList() {
  const { currentHotel } = useHotel();
  const resolvedQ = useResolvedRooms(currentHotel?.id);
  const roomsQ = useRooms(currentHotel?.id);

  const overrides = React.useMemo(() => {
    const map = new Map<string, number>();
    (roomsQ.data ?? []).forEach((r) => map.set(r.id, overrideCount(r)));
    return map;
  }, [roomsQ.data]);
  const updatedAt = React.useMemo(() => {
    const map = new Map<string, string>();
    (roomsQ.data ?? []).forEach((r) => map.set(r.id, r.updated_at));
    return map;
  }, [roomsQ.data]);

  const loading = resolvedQ.isLoading || roomsQ.isLoading;
  const rooms = resolvedQ.data ?? [];

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader
        crumbs={[{ label: "Content", href: "/content" }, { label: "Rooms" }]}
        title="Rooms"
        subtitle="Effective, guest-facing room details after inheritance."
        actions={
          <Button asChild variant="secondary"><Link href="/content/rooms/types"><Layers className="h-4 w-4" /> Room types</Link></Button>
        }
      />

      {resolvedQ.isError ? (
        <ErrorState error={resolvedQ.error} onRetry={() => resolvedQ.refetch()} />
      ) : loading ? (
        <SectionLoader rows={5} />
      ) : rooms.length === 0 ? (
        <EmptyState icon={Layers} title="No rooms yet" hint="Room types and rooms will appear here once added for this hotel." action={<Button asChild variant="primary"><Link href="/content/rooms/types">Set up room types</Link></Button>} />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border-subtle text-[11px] uppercase tracking-wide text-ink-tertiary">
                  <th className="px-4 py-2.5 text-left font-medium">Room</th>
                  <th className="px-4 py-2.5 text-left font-medium">Type</th>
                  <th className="px-4 py-2.5 text-left font-medium">Floor</th>
                  <th className="px-4 py-2.5 text-left font-medium">Capacity</th>
                  <th className="px-4 py-2.5 text-left font-medium">Smart glass</th>
                  <th className="px-4 py-2.5 text-left font-medium">Heating</th>
                  <th className="px-4 py-2.5 text-left font-medium">View</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Updated</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => {
                  const oc = overrides.get(r.room_id) ?? 0;
                  return (
                    <tr key={r.room_id} className="group border-b border-border-subtle last:border-0 hover:bg-surface-overlay/50">
                      <td className="px-4 py-3">
                        <Link href={`/content/rooms/${r.room_id}`} className="flex items-center gap-2 font-medium text-ink-primary">
                          {r.room_number}
                          {oc > 0 && <Badge tone="brand" className="text-[10px]">{oc} override{oc > 1 ? "s" : ""}</Badge>}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">{r.room_type_name}</td>
                      <td className="px-4 py-3 text-ink-tertiary">{r.floor ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-secondary tabular-nums">{r.capacity ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-secondary">{boolText(r.smart_glass)}</td>
                      <td className="px-4 py-3 text-ink-secondary">{boolText(r.underfloor_heating)}</td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-ink-tertiary">{r.view_description ?? "—"}</td>
                      <td className="px-4 py-3">{r.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</td>
                      <td className="px-4 py-3 text-right text-[12px] text-ink-tertiary">{relativeTime(updatedAt.get(r.room_id) ?? "")}</td>
                      <td className="px-2">
                        <Link href={`/content/rooms/${r.room_id}`} className="flex h-7 w-7 items-center justify-center rounded text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink-primary">
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
