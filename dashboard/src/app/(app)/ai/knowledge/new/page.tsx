"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useCreateArticle, useKnowledgeCategories } from "@/data/knowledge";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { PermissionDenied } from "@/components/content/states";
import { TextField, Field } from "@/components/content/fields";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `article-${Math.floor(Math.random() * 1e5)}`;

export default function NewArticle() {
  const router = useRouter();
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const create = useCreateArticle(currentHotel?.id);
  const categoriesQ = useKnowledgeCategories(currentHotel?.id);

  const [title, setTitle] = React.useState("");
  const [key, setKey] = React.useState("");
  const [keyEdited, setKeyEdited] = React.useState(false);
  const [categoryId, setCategoryId] = React.useState("");
  const [locale, setLocale] = React.useState("en");
  const [error, setError] = React.useState<string | null>(null);

  const canAuthor = role === "platform_admin" || role === "hotel_admin" || role === "editor";
  React.useEffect(() => { if (!keyEdited) setKey(slugify(title)); }, [title, keyEdited]);
  React.useEffect(() => { if (!categoryId && categoriesQ.data?.length) setCategoryId(categoriesQ.data[0].id); }, [categoriesQ.data, categoryId]);

  const submit = async () => {
    setError(null);
    try {
      const id = await create.mutateAsync({
        title: title.trim() || "Untitled answer", key: slugify(key || title), locale,
        category_id: categoryId || null, available_to_ai: true,
        body_content: { version: 1, blocks: [{ type: "paragraph", text: "" }] },
      } as any);
      router.push(`/ai/knowledge/${id}`);
    } catch (e) { setError(humanizeError(e)); }
  };

  return (
    <div className="mx-auto max-w-[720px] p-6">
      <PageHeader
        crumbs={[{ label: "AI", href: "/ai" }, { label: "Knowledge", href: "/ai/knowledge" }, { label: "New article" }]}
        title="New knowledge article"
        subtitle="Starts as a draft — nothing reaches the AI until you publish."
        backHref="/ai/knowledge"
      />

      {!canAuthor ? (
        <PermissionDenied message="Your role can view knowledge but not create new articles." />
      ) : (
        <Card className="p-5">
          <div className="space-y-4">
            <TextField label="Title" value={title} onChange={setTitle} placeholder="Wi-Fi access" />
            <TextField label="Key" hint="stable identifier · lowercase-with-dashes" value={key} onChange={(v) => { setKey(v); setKeyEdited(true); }} placeholder="wifi-access" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category">
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">
                  <option value="">Uncategorized</option>
                  {(categoriesQ.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.hotel_id ? "" : " (platform)"}</option>)}
                </select>
              </Field>
              <Field label="Locale">
                <select value={locale} onChange={(e) => setLocale(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">
                  {["en", "hr", "de", "it", "fr", "es"].map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
            </div>
            {error && <p className="text-[12px] text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => router.push("/ai/knowledge")}>Cancel</Button>
              <Button variant="primary" onClick={submit} loading={create.isPending} disabled={!title.trim()}>Create draft</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
