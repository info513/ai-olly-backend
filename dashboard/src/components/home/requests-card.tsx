"use client";

import Link from "next/link";
import { ConciergeBell, ArrowRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/utils";
import type { RequestLite } from "@/mock/types";

const PRIORITY_TONE: Record<RequestLite["priority"], "neutral" | "info" | "warning" | "danger"> = {
  low: "neutral",
  normal: "info",
  high: "warning",
  urgent: "danger",
};
const STATUS_LABEL: Record<RequestLite["status"], string> = {
  new: "New",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
};

export function RequestsCard({ items }: { items: RequestLite[] }) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ConciergeBell className="h-4 w-4 text-ink-tertiary" />
          <CardTitle>Open requests</CardTitle>
          <Badge tone={items.some((r) => r.priority === "urgent") ? "danger" : "brand"}>{items.length}</Badge>
        </div>
        <Link href="/reception" className="text-[12px] text-ink-tertiary transition-colors hover:text-ink-primary">
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardHeader>
      <CardContent className="flex-1">
        <ul className="space-y-1">
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-overlay">
              <span className="flex h-8 w-12 items-center justify-center rounded-md bg-surface-overlay text-[12px] font-semibold text-ink-secondary">
                {r.room}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink-primary">{r.title}</span>
                <span className="block text-[11px] text-ink-tertiary">
                  {STATUS_LABEL[r.status]} · {relativeTime(r.createdAt)}
                </span>
              </span>
              <Badge tone={PRIORITY_TONE[r.priority]} dot>
                {r.priority}
              </Badge>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-2 py-6 text-center text-[13px] text-ink-tertiary">No open requests — nice work.</li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
