"use client";

import { AlertTriangle, Inbox, ShieldAlert, RotateCw, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { humanizeError } from "@/data/errors";

/** Warm empty state (UX Bible §15) — never a blank void. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  hint,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-border-subtle bg-surface-raised/40 px-6 py-14 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-surface-overlay text-ink-tertiary">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-[14px] font-medium text-ink-primary">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-[13px] text-ink-tertiary">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Calm error state with a retry (never a raw Supabase dump). */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="grid place-items-center rounded-lg border border-danger/30 bg-danger-soft/40 px-6 py-12 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-danger-soft text-danger">
        <AlertTriangle className="h-5 w-5" />
      </span>
      <p className="text-[14px] font-medium text-ink-primary">{humanizeError(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RotateCw className="h-4 w-4" /> Retry
        </Button>
      )}
    </div>
  );
}

export function PermissionDenied({ message = "You don’t have permission to edit this here." }: { message?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border-subtle bg-surface-raised px-4 py-3 text-[13px] text-ink-secondary">
      <ShieldAlert className="h-4 w-4 shrink-0 text-warning" />
      {message}
    </div>
  );
}

export function SectionLoader({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}
