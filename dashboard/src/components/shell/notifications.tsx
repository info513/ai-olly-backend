"use client";

import Link from "next/link";
import { Bell, AlertTriangle, CircleAlert, Info, ListTodo, CheckCircle2 } from "lucide-react";
import { useOpNotifications, type NotifTier } from "@/data/notifications";
import { useHotel } from "@/providers/hotel-provider";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime, cn } from "@/lib/utils";

const TIER: Record<NotifTier, { icon: typeof Info; color: string }> = {
  critical: { icon: CircleAlert, color: "text-danger" },
  warning: { icon: AlertTriangle, color: "text-warning" },
  task: { icon: ListTodo, color: "text-info" },
  info: { icon: Info, color: "text-ink-tertiary" },
  success: { icon: CheckCircle2, color: "text-success" },
};

/**
 * Real, hotel-scoped operational feed derived from requests / stays / consents /
 * feedback (Part 16). No push sending; the badge counts items that need action
 * (critical + warning). RLS-scoped; empty for roles without operational access.
 */
export function Notifications() {
  const { currentHotel } = useHotel();
  const { data, isLoading } = useOpNotifications(currentHotel?.id);
  const items = data ?? [];
  const urgent = items.filter((n) => n.tier === "critical" || n.tier === "warning").length;

  return (
    <Popover>
      <PopoverTrigger aria-label="Notifications" className="relative flex h-9 w-9 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-overlay hover:text-ink-primary">
        <Bell className="h-[18px] w-[18px]" />
        {urgent > 0 && <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{urgent}</span>}
      </PopoverTrigger>
      <PopoverContent className="w-[380px]">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <span className="text-[13px] font-semibold text-ink-primary">What needs attention</span>
          <span className="text-[11px] text-ink-tertiary">{items.length} item{items.length === 1 ? "" : "s"}</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {isLoading ? (
            <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-ink-tertiary">All clear — nothing needs attention.</p>
          ) : (
            items.map((n) => {
              const T = TIER[n.tier];
              const Icon = T.icon;
              return (
                <Link key={n.id} href={n.href} className="flex gap-3 px-4 py-3 transition-colors hover:bg-surface-raised">
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", T.color)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink-primary">{n.title}</span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-ink-secondary">{n.body}</span>
                    <span className="mt-1 block text-[11px] text-ink-tertiary">{relativeTime(n.createdAt)}</span>
                  </span>
                </Link>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
