"use client";

import Link from "next/link";
import { Bell, AlertTriangle, CircleAlert, CheckCircle2, Info, ListTodo } from "lucide-react";
import { useNotifications } from "@/hooks/use-dashboard";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime, cn } from "@/lib/utils";
import type { NotificationTier } from "@/mock/types";

const TIER: Record<NotificationTier, { icon: typeof Info; color: string }> = {
  critical: { icon: CircleAlert, color: "text-danger" },
  warning: { icon: AlertTriangle, color: "text-warning" },
  task: { icon: ListTodo, color: "text-info" },
  info: { icon: Info, color: "text-ink-tertiary" },
  success: { icon: CheckCircle2, color: "text-success" },
};

export function Notifications() {
  const { data, isLoading } = useNotifications();
  const unread = (data ?? []).filter((n) => !n.read).length;

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-overlay hover:text-ink-primary"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[380px]">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <span className="text-[13px] font-semibold text-ink-primary">Notifications</span>
          <button className="text-[12px] text-ink-tertiary transition-colors hover:text-ink-primary">
            Mark all read
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            (data ?? []).map((n) => {
              const T = TIER[n.tier];
              const Icon = T.icon;
              return (
                <Link
                  key={n.id}
                  href={n.href ?? "#"}
                  className={cn(
                    "flex gap-3 px-4 py-3 transition-colors hover:bg-surface-raised",
                    !n.read && "bg-surface-raised/60"
                  )}
                >
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", T.color)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-ink-primary">{n.title}</span>
                      {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-cream" />}
                    </span>
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
