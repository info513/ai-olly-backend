"use client";

import Link from "next/link";
import { FileSignature, ArrowRight, ShieldCheck, FileText } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useConsentTemplates, signableTemplates, useConsents } from "@/data/consents";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader } from "@/components/content/states";
import { ConsentPill } from "@/components/reception/rec-pills";
import { Card } from "@/components/ui/card";
import { relativeTime } from "@/lib/utils";

export default function ConsentHome() {
  const { currentHotel } = useHotel();
  const templatesQ = useConsentTemplates(currentHotel?.id);
  const consentsQ = useConsents(currentHotel?.id);

  const signable = signableTemplates(templatesQ.data ?? []);
  const drafts = (templatesQ.data ?? []).filter((t) => t.status === "draft" && t.hotelId === currentHotel?.id);
  const recent = (consentsQ.data ?? []).slice(0, 8);

  return (
    <div className="mx-auto max-w-[1100px] p-6">
      <PageHeader title="Consent" subtitle="Signed consent records and the templates guests sign from." />

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/consent/templates">
          <Card className="group h-full p-5 transition-colors hover:border-border-strong">
            <div className="flex items-start justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-navy text-brand-cream"><FileText className="h-5 w-5" /></span><ArrowRight className="h-4 w-4 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" /></div>
            <div className="mt-4 font-display text-[20px] text-ink-primary">Templates</div>
            <p className="mt-1 text-[13px] text-ink-secondary">Versioned consent wording. Only published versions can be signed.</p>
            <div className="mt-3 text-[12px] text-ink-tertiary">{templatesQ.isLoading ? "…" : `${signable.length} signable · ${drafts.length} draft`}</div>
          </Card>
        </Link>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary"><ShieldCheck className="h-4 w-4" /> Signable now</div>
          {templatesQ.isLoading ? <div className="mt-3"><SectionLoader rows={2} /></div> : signable.length === 0 ? (
            <p className="mt-3 text-[13px] text-ink-tertiary">No published templates yet. <Link href="/consent/templates" className="text-brand-cream hover:underline">Create one →</Link></p>
          ) : (
            <ul className="mt-3 space-y-2">{signable.map((t) => <li key={t.id} className="flex items-center gap-2 text-[13px]"><FileSignature className="h-4 w-4 shrink-0 text-ink-tertiary" /><span className="min-w-0 flex-1 truncate text-ink-primary">{t.title}</span><span className="text-[11px] uppercase text-ink-tertiary">{t.locale} · v{t.version}</span></li>)}</ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Recent signed consents</div>
        {consentsQ.isLoading ? <SectionLoader rows={4} /> : recent.length === 0 ? (
          <Card className="p-8 text-center text-[13px] text-ink-tertiary">No consents recorded yet.</Card>
        ) : (
          <Card className="overflow-hidden p-0"><div className="divide-y divide-border-subtle">
            {recent.map((c) => (
              <Link key={c.id} href={`/consent/${c.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-overlay/40">
                <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-ink-primary">{c.guestName ?? "Guest"}</div><div className="text-[12px] text-ink-tertiary">{c.consentType} v{c.consentVersion} · {relativeTime(c.signedAt)}</div></div>
                <ConsentPill hasConsent={c.status === "granted"} revoked={c.status === "revoked"} />
              </Link>
            ))}
          </div></Card>
        )}
      </div>
    </div>
  );
}
