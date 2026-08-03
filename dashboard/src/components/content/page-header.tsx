"use client";

import Link from "next/link";
import { ChevronRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  href?: string;
}

/** Consistent page header with breadcrumbs + actions (Design System §13). */
export function PageHeader({
  crumbs,
  title,
  subtitle,
  actions,
  backHref,
  className,
}: {
  crumbs?: Crumb[];
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  backHref?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-6", className)}>
      {crumbs && crumbs.length > 0 && (
        <nav className="mb-2 flex items-center gap-1 text-[12px] text-ink-tertiary">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5" />}
              {c.href ? (
                <Link href={c.href} className="transition-colors hover:text-ink-secondary">{c.label}</Link>
              ) : (
                <span className="text-ink-secondary">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {backHref && (
            <Link
              href={backHref}
              className="mt-1 flex h-8 w-8 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-overlay hover:text-ink-primary"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          <div className="min-w-0">
            <h1 className="font-display text-[26px] leading-tight text-ink-primary">{title}</h1>
            {subtitle && <p className="mt-1 text-[14px] text-ink-secondary">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
