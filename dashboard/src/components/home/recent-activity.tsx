"use client";

import { CheckCircle2, ListTodo, AlertTriangle, Info } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { relativeTime, cn } from "@/lib/utils";
import type { ActivityItem, NotificationTier } from "@/mock/types";

const TIER: Record<NotificationTier, { icon: typeof Info; color: string }> = {
  critical: { icon: AlertTriangle, color: "text-danger" },
  warning: { icon: AlertTriangle, color: "text-warning" },
  task: { icon: ListTodo, color: "text-info" },
  info: { icon: Info, color: "text-ink-tertiary" },
  success: { icon: CheckCircle2, color: "text-success" },
};

export function RecentActivity({ items }: { items: ActivityItem[] }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-border-subtle">
          {items.map((a) => {
            const T = TIER[a.tier];
            const Icon = T.icon;
            return (
              <li key={a.id} className="relative flex gap-3 pl-0">
                <span className="z-10 mt-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface-raised">
                  <Icon className={cn("h-3.5 w-3.5", T.color)} />
                </span>
                <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink-secondary">
                  <span className="font-medium text-ink-primary">{a.actor}</span> {a.action}{" "}
                  <span className="text-ink-primary">{a.target}</span>
                  <span className="mt-0.5 block text-[11px] text-ink-tertiary">{relativeTime(a.createdAt)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
