"use client";

import Link from "next/link";
import { Building2, Users, Sparkles, FileSignature, ArrowRight, Hammer } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { PageHeader } from "@/components/content/page-header";
import { Card } from "@/components/ui/card";

/** Low-frequency configuration only — everyday work lives in the job areas.
 *  Built items link out to their existing pages; not-yet-built items show "soon". */
const GROUPS: { title: string; items: { icon: typeof Building2; label: string; desc: string; href?: string }[] }[] = [
  {
    title: "Hotel",
    items: [
      { icon: Building2, label: "Hotel profile", desc: "Name, address, contact and check-in/out times." },
      { icon: Users, label: "Users & access", desc: "Team members, roles and invitations." },
    ],
  },
  {
    title: "Olly & guest data",
    items: [
      { icon: Sparkles, label: "Olly settings", desc: "Facts and approved wording Olly uses.", href: "/ai/configuration" },
      { icon: FileSignature, label: "Consent templates", desc: "Consent text, versions and administration.", href: "/consent/templates" },
    ],
  },
];

export default function SettingsHome() {
  const { currentHotel } = useHotel();
  return (
    <div className="mx-auto max-w-[1000px] p-6">
      <PageHeader
        title="Settings"
        subtitle={`Configuration for ${currentHotel?.name ?? "your hotel"} — the things you set once and rarely change.`}
      />
      <div className="space-y-6">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">{g.title}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {g.items.map((it) => <SettingCard key={it.label} {...it} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingCard({ icon: Icon, label, desc, href }: { icon: typeof Building2; label: string; desc: string; href?: string }) {
  const inner = (
    <Card className={`group h-full p-5 ${href ? "transition-colors hover:border-border-strong" : "opacity-70"}`}>
      <div className="flex items-start justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-navy text-brand-cream"><Icon className="h-5 w-5" /></span>
        {href ? <ArrowRight className="h-4 w-4 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
          : <span className="inline-flex items-center gap-1 rounded-full bg-surface-overlay px-2 py-0.5 text-[10px] font-medium text-ink-tertiary"><Hammer className="h-3 w-3" /> Soon</span>}
      </div>
      <div className="mt-4 font-display text-[18px] text-ink-primary">{label}</div>
      <p className="mt-1 text-[13px] text-ink-secondary">{desc}</p>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : <div>{inner}</div>;
}
