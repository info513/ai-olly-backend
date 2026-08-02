"use client";

import Link from "next/link";
import { LogIn, LogOut, ArrowRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { StayLite } from "@/mock/types";

/** Today's arrivals / departures — safe fields only (first name + room + time). */
export function TodayCard({
  kind,
  items,
}: {
  kind: "arrivals" | "departures";
  items: StayLite[];
}) {
  const isArrivals = kind === "arrivals";
  const Icon = isArrivals ? LogIn : LogOut;
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-ink-tertiary" />
          <CardTitle>Today’s {isArrivals ? "arrivals" : "departures"}</CardTitle>
          <Badge tone="brand">{items.length}</Badge>
        </div>
        <Link href="/reception" className="text-[12px] text-ink-tertiary transition-colors hover:text-ink-primary">
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardHeader>
      <CardContent className="flex-1">
        <ul className="space-y-1">
          {items.slice(0, 5).map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-overlay">
              <span className="flex h-8 w-12 items-center justify-center rounded-md bg-surface-overlay text-[12px] font-semibold text-ink-secondary">
                {s.room}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink-primary">{s.guestFirstName}</span>
                {s.note && <span className="block truncate text-[11px] text-warning">{s.note}</span>}
              </span>
              <span className="text-[12px] tabular-nums text-ink-tertiary">{s.time}</span>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-2 py-6 text-center text-[13px] text-ink-tertiary">
              Nothing scheduled — a calm day.
            </li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
