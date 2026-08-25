"use client";

import Link from "next/link";
import { Mail, ChevronRight, Plus } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useTemplates, hasUnpublishedTemplateChanges } from "@/data/newsletter-templates";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { StatusPill } from "@/components/content/pills";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/utils";
import type { NewsletterTemplate } from "@/data/newsletter-types";

export default function TemplatesList() {
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const q = useTemplates(currentHotel?.id);
  const canManage = role === "platform_admin" || role === "hotel_admin" || role === "marketing";

  return (
    <div className="mx-auto max-w-[1000px] p-6">
      <PageHeader
        crumbs={[{ label: "Marketing", href: "/newsletter" }, { label: "Email designs" }]}
        title="Email designs"
        subtitle="Structured email templates. Draft → publish → history; scheduled campaigns freeze their own snapshot."
        actions={canManage && <Link href="/newsletter/templates/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[13px] font-semibold text-brand-navy hover:bg-brand-creamSoft"><Plus className="h-4 w-4" /> New template</Link>}
        backHref="/newsletter"
      />

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <SectionLoader rows={4} />
        : (q.data ?? []).length === 0 ? <EmptyState icon={Mail} title="No templates yet" hint="Create your first email template." action={canManage && <Link href="/newsletter/templates/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[13px] font-semibold text-brand-navy">New template</Link>} />
        : <Card className="overflow-hidden p-0"><div className="divide-y divide-border-subtle">{q.data!.map((t) => <Row key={t.id} t={t} />)}</div></Card>}
    </div>
  );
}

function Row({ t }: { t: NewsletterTemplate }) {
  const pending = hasUnpublishedTemplateChanges(t);
  return (
    <Link href={`/newsletter/templates/${t.id}`} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-overlay/50">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="truncate font-medium text-ink-primary">{t.name}</span>{t.hotelId === null && <Badge tone="brand">Platform</Badge>}{pending && <Badge tone="warning" dot>Unpublished changes</Badge>}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-tertiary"><span className="truncate">{t.subject}</span><span>·</span><span className="uppercase">{t.locale}</span><span>·</span><span>{relativeTime(t.updatedAt)}</span></div>
      </div>
      <StatusPill status={t.status} />
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
