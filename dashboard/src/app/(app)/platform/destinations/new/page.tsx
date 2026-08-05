"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useCreateDestination, DESTINATION_TYPES, type DestinationType } from "@/data/platform-destinations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const slugify = (s: string) =>
  s.toLowerCase().trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const FIELD = "space-y-1";
const LABEL = "block text-[12px] font-medium text-ink-secondary";
const SELECT_CLS = "w-full appearance-none rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2 text-sm text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2";

export default function NewDestinationPage() {
  const router = useRouter();
  const create = useCreateDestination();
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [country, setCountry] = React.useState("HR");
  const [type, setType] = React.useState<DestinationType>("city");
  const [timezone, setTimezone] = React.useState("Europe/Zagreb");
  const [locale, setLocale] = React.useState("en");
  const [shortDescription, setShortDescription] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);

  const effectiveSlug = slugTouched ? slug : slugify(name);
  const canSubmit = name.trim().length >= 2 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(effectiveSlug) && !!timezone.trim() && /^[a-z]{2}(-[a-z]{2})?$/.test(locale);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const id = await create.mutateAsync({
        name: name.trim(),
        slug: effectiveSlug,
        country_code: country.trim().toUpperCase() || null,
        destination_type: type,
        timezone: timezone.trim(),
        default_locale: locale.trim(),
        supported_locales: [locale.trim()],
        short_description: shortDescription.trim() || null,
      });
      router.push(`/platform/destinations/${id}`);
    } catch (e: any) {
      setErr(e?.code === "23505" ? `Slug “${effectiveSlug}” is already taken — choose another.` : (e?.message ?? "Failed to create destination."));
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <Link href="/platform/destinations" className="inline-flex items-center gap-1.5 text-[13px] text-ink-tertiary hover:text-ink-primary">
        <ArrowLeft className="h-4 w-4" /> Destinations
      </Link>
      <header>
        <h1 className="text-xl font-semibold text-ink-primary">New destination</h1>
        <p className="mt-1 text-sm text-ink-tertiary">Creates a <span className="font-medium text-ink-secondary">draft</span>. You’ll add details and publish on the next screen.</p>
      </header>

      <form onSubmit={submit} className="space-y-4 rounded-xl border border-border-subtle bg-surface-raised p-5">
        <div className={FIELD}>
          <label className={LABEL} htmlFor="name">Name</label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dubrovnik" autoFocus />
        </div>
        <div className={FIELD}>
          <label className={LABEL} htmlFor="slug">Slug</label>
          <Input id="slug" value={effectiveSlug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} placeholder="dubrovnik" />
          <p className="text-[11px] text-ink-tertiary">Lowercase, hyphenated. Must be unique across all destinations.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={FIELD}>
            <label className={LABEL} htmlFor="country">Country (ISO-2)</label>
            <Input id="country" value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} placeholder="HR" maxLength={2} />
          </div>
          <div className={FIELD}>
            <label className={LABEL} htmlFor="type">Type</label>
            <select id="type" className={SELECT_CLS} value={type} onChange={(e) => setType(e.target.value as DestinationType)}>
              {DESTINATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className={FIELD}>
            <label className={LABEL} htmlFor="tz">Timezone</label>
            <Input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Europe/Zagreb" />
          </div>
          <div className={FIELD}>
            <label className={LABEL} htmlFor="locale">Canonical locale</label>
            <Input id="locale" value={locale} onChange={(e) => setLocale(e.target.value.toLowerCase())} placeholder="en" />
          </div>
        </div>
        <div className={FIELD}>
          <label className={LABEL} htmlFor="desc">Short description <span className="text-ink-tertiary">(optional)</span></label>
          <textarea id="desc" value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} rows={2}
            className="w-full rounded-md border border-border-subtle bg-surface-sunken px-2.5 py-2 text-sm text-ink-primary outline-none ring-brand-goldDeep/40 focus:ring-2" />
        </div>

        {err && <p className="rounded-md bg-danger-soft/50 px-3 py-2 text-[13px] text-danger">{err}</p>}

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-4">
          <Button asChild variant="ghost" size="sm"><Link href="/platform/destinations">Cancel</Link></Button>
          <Button type="submit" variant="primary" size="sm" disabled={!canSubmit || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create draft
          </Button>
        </div>
      </form>
    </div>
  );
}
