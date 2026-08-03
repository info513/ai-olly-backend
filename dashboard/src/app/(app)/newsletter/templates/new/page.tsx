"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useCreateTemplate } from "@/data/newsletter-templates";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { PermissionDenied } from "@/components/content/states";
import { TextField, TextAreaField, Field } from "@/components/content/fields";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export default function NewTemplate() {
  const router = useRouter();
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const create = useCreateTemplate(currentHotel?.id);
  const [name, setName] = React.useState("");
  const [key, setKey] = React.useState("");
  const [keyEdited, setKeyEdited] = React.useState(false);
  const [subject, setSubject] = React.useState("");
  const [preview, setPreview] = React.useState("");
  const [locale, setLocale] = React.useState("en");
  const [error, setError] = React.useState<string | null>(null);

  const canManage = role === "platform_admin" || role === "hotel_admin" || role === "marketing";
  React.useEffect(() => { if (!keyEdited) setKey(slug(name)); }, [name, keyEdited]);

  const submit = async () => {
    setError(null);
    if (!name.trim() || !subject.trim()) { setError("Name and subject are required."); return; }
    try { const id = await create.mutateAsync({ key: slug(key || name), name: name.trim(), subject: subject.trim(), previewText: preview.trim() || undefined, locale }); router.push(`/newsletter/templates/${id}`); }
    catch (e) { setError(humanizeError(e)); }
  };

  return (
    <div className="mx-auto max-w-[720px] p-6">
      <PageHeader crumbs={[{ label: "Newsletter", href: "/newsletter" }, { label: "Templates", href: "/newsletter/templates" }, { label: "New" }]} title="New template" subtitle="Starts as a draft. Publish to make it usable in campaigns." backHref="/newsletter/templates" />
      {!canManage ? <PermissionDenied message="Only hotel admins and marketing can create templates." /> : (
        <Card className="p-5">
          <div className="space-y-4">
            <TextField label="Name" value={name} onChange={setName} placeholder="Season newsletter" />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Key" hint="lowercase-with-dashes" value={key} onChange={(v) => { setKey(v); setKeyEdited(true); }} placeholder="season-newsletter" />
              <Field label="Locale"><select value={locale} onChange={(e) => setLocale(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">{["en", "hr", "de", "it", "fr", "es"].map((l) => <option key={l} value={l}>{l}</option>)}</select></Field>
            </div>
            <TextField label="Subject" value={subject} onChange={setSubject} placeholder="What's new at Demo Hotel" />
            <TextAreaField label="Preview text" hint="inbox snippet" value={preview} onChange={setPreview} rows={2} />
            {error && <p className="text-[12px] text-danger">{error}</p>}
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => router.push("/newsletter/templates")}>Cancel</Button><Button variant="primary" onClick={submit} loading={create.isPending} disabled={!name.trim() || !subject.trim()}>Create draft</Button></div>
          </div>
        </Card>
      )}
    </div>
  );
}
