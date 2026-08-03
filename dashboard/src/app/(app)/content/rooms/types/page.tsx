"use client";

import Link from "next/link";
import { Plus, Layers, ChevronRight } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useRoomTypes } from "@/data/rooms";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { relativeTime } from "@/lib/utils";

const canEditRole = (role: string | null) => role === "platform_admin" || role === "hotel_admin" || role === "editor";
const boolText = (v: boolean | null) => (v === true ? "Yes" : v === false ? "No" : "—");

export default function RoomTypesList() {
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const { data, isLoading, isError, error, refetch } = useRoomTypes(currentHotel?.id);
  const mayEdit = canEditRole(role);

  return (
    <div className="mx-auto max-w-[1100px] p-6">
      <PageHeader
        crumbs={[{ label: "Content", href: "/content" }, { label: "Rooms", href: "/content/rooms" }, { label: "Room types" }]}
        title="Room types"
        subtitle="Shared defaults that rooms inherit. Change a fact once, every room updates."
        backHref="/content/rooms"
        actions={mayEdit && <Button asChild variant="primary"><Link href="/content/rooms/types/new"><Plus className="h-4 w-4" /> New room type</Link></Button>}
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SectionLoader />
      ) : (data ?? []).length === 0 ? (
        <EmptyState icon={Layers} title="No room types yet" hint="Create your first room type — Deluxe, Standard — and rooms inherit its defaults." action={mayEdit && <Button asChild variant="primary"><Link href="/content/rooms/types/new">New room type</Link></Button>} />
      ) : (
        <div className="space-y-2">
          {data!.map((rt) => (
            <Link key={rt.id} href={`/content/rooms/types/${rt.id}`}>
              <Card className="group flex items-center gap-4 p-4 transition-colors hover:border-border-strong">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-overlay text-ink-secondary"><Layers className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink-primary">{rt.name}</span>
                    {rt.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-tertiary">
                    {rt.roomCount ?? 0} room{(rt.roomCount ?? 0) === 1 ? "" : "s"} · Capacity {rt.default_capacity ?? "—"} · Smart glass {boolText(rt.smart_glass)} · Heating {boolText(rt.underfloor_heating)}
                  </div>
                </div>
                <span className="text-[12px] text-ink-tertiary">{relativeTime(rt.updated_at)}</span>
                <ChevronRight className="h-4 w-4 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
