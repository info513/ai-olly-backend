"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, BookOpen, ChevronRight, X } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useKnowledgeArticles, useKnowledgeCategories } from "@/data/knowledge";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { StatusPill } from "@/components/content/pills";
import { ScopeBadge, CriticalBadge, AiChip, ValidityChip } from "@/components/ai/ai-pills";
import { ResolvedKnowledgePanel } from "@/components/ai/resolved-knowledge-panel";
import { AliasesPanel } from "@/components/ai/aliases-panel";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { relativeTime, cn } from "@/lib/utils";
import type { KnowledgeArticle, KnowledgeScope } from "@/data/ai-types";
import type { ContentStatus } from "@/data/types";

const canAuthor = (role: string | null) => role === "platform_admin" || role === "hotel_admin" || role === "editor";
const isExpired = (a: KnowledgeArticle) => a.valid_to != null && new Date(a.valid_to).getTime() < Date.now();

export default function KnowledgeList() {
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const params = useSearchParams();
  const router = useRouter();
  const articlesQ = useKnowledgeArticles(currentHotel?.id);
  const categoriesQ = useKnowledgeCategories(currentHotel?.id);

  const [tab, setTab] = React.useState<"list" | "resolved" | "aliases">("list");
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<ContentStatus | "all">((params.get("status") as ContentStatus) ?? "all");
  const [scope, setScope] = React.useState<KnowledgeScope | "all">("all");
  const [category, setCategory] = React.useState("all");
  const [locale, setLocale] = React.useState("all");
  const [special, setSpecial] = React.useState(params.get("filter") ?? "all");

  const locales = React.useMemo(() => Array.from(new Set((articlesQ.data ?? []).map((a) => a.locale))).sort(), [articlesQ.data]);

  const items = React.useMemo(() => {
    let list = articlesQ.data ?? [];
    if (status !== "all") list = list.filter((a) => a.status === status);
    if (scope !== "all") list = list.filter((a) => a.source_type === scope);
    if (category !== "all") list = list.filter((a) => a.category_id === category);
    if (locale !== "all") list = list.filter((a) => a.locale === locale);
    if (special === "expired-critical") list = list.filter((a) => a.is_critical && isExpired(a));
    if (special === "critical-pending") list = list.filter((a) => a.is_critical && a.status !== "published");
    if (special === "missing-answer") list = list.filter((a) => a.available_to_ai && !a.approved_answer);
    if (special === "expired") list = list.filter(isExpired);
    if (special === "critical") list = list.filter((a) => a.is_critical);
    if (special === "ai") list = list.filter((a) => a.available_to_ai);
    if (q.trim()) {
      const t = q.toLowerCase();
      list = list.filter((a) => a.title.toLowerCase().includes(t) || a.key.toLowerCase().includes(t) || (a.approved_answer ?? "").toLowerCase().includes(t) || (a.categoryName ?? "").toLowerCase().includes(t));
    }
    return list;
  }, [articlesQ.data, status, scope, category, locale, special, q]);

  const filtersActive = status !== "all" || scope !== "all" || category !== "all" || locale !== "all" || special !== "all" || !!q;

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader
        crumbs={[{ label: "AI", href: "/ai" }, { label: "Knowledge" }]}
        title="What Olly knows"
        subtitle="Everything Olly can tell guests — platform defaults, destination tips, and your hotel's own answers."
        actions={canAuthor(role) && <Link href="/ai/knowledge/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[13px] font-semibold text-brand-navy hover:bg-brand-creamSoft"><Plus className="h-4 w-4" /> New article</Link>}
      />

      {/* Tabs */}
      <div className="mb-4 flex items-center gap-1 border-b border-border-subtle">
        {(["list", "resolved", "aliases"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("relative px-3 py-2 text-[13px] font-medium transition-colors", tab === t ? "text-ink-primary" : "text-ink-tertiary hover:text-ink-secondary")}>
            {t === "list" ? "All articles" : t === "resolved" ? "Retrieval preview" : "Aliases"}
            {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-cream" />}
          </button>
        ))}
      </div>

      {tab === "resolved" ? (
        <ResolvedKnowledgePanel hotelId={currentHotel?.id} />
      ) : tab === "aliases" ? (
        <AliasesPanel hotelId={currentHotel?.id} canManage={canAuthor(role)} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, key or answer…" className="h-8 w-64 pl-8" />
            </div>
            <Filter value={status} onChange={setStatus} options={[["all", "All statuses"], ["draft", "Draft"], ["preview", "Preview"], ["published", "Live"], ["archived", "Archived"]]} />
            <Filter value={scope} onChange={setScope} options={[["all", "All scopes"], ["platform", "Platform"], ["destination", "Destination"], ["hotel", "Hotel"], ["override", "Hotel override"]]} />
            <Filter value={category} onChange={setCategory} options={[["all", "All categories"], ...((categoriesQ.data ?? []).map((c) => [c.id, c.name] as [string, string]))]} />
            {locales.length > 1 && <Filter value={locale} onChange={setLocale} options={[["all", "All locales"], ...locales.map((l) => [l, l] as [string, string])]} />}
            <Filter value={special} onChange={setSpecial} options={[["all", "Any"], ["ai", "Available to AI"], ["critical", "Critical"], ["missing-answer", "Missing approved answer"], ["expired", "Expired"], ["expired-critical", "Expired critical"], ["critical-pending", "Critical, unpublished"]]} />
            {filtersActive && (
              <button onClick={() => { setStatus("all"); setScope("all"); setCategory("all"); setLocale("all"); setSpecial("all"); setQ(""); router.replace("/ai/knowledge"); }} className="flex items-center gap-1 text-[12px] text-ink-tertiary hover:text-ink-secondary"><X className="h-3.5 w-3.5" /> Clear</button>
            )}
          </div>

          {articlesQ.isError ? (
            <ErrorState error={articlesQ.error} onRetry={() => articlesQ.refetch()} />
          ) : articlesQ.isLoading ? (
            <SectionLoader rows={6} />
          ) : items.length === 0 ? (
            <EmptyState icon={BookOpen} title={(articlesQ.data ?? []).length ? "No articles match your filters" : "No knowledge yet"} hint={(articlesQ.data ?? []).length ? "Try clearing the filters." : "Add your first answer — check-in, Wi-Fi, parking, emergencies."} action={canAuthor(role) && !(articlesQ.data ?? []).length && <Link href="/ai/knowledge/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[13px] font-semibold text-brand-navy">New article</Link>} />
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="divide-y divide-border-subtle">
                {items.map((a) => <ArticleRow key={a.id} a={a} />)}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function ArticleRow({ a }: { a: KnowledgeArticle }) {
  const missingAnswer = a.available_to_ai && !a.approved_answer;
  return (
    <Link href={`/ai/knowledge/${a.id}`} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-overlay/50">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-ink-primary">{a.title}</span>
          {a.is_critical && <CriticalBadge />}
          {missingAnswer && <span className="rounded bg-warning-soft/50 px-1.5 py-0.5 text-[10px] font-medium text-warning">No approved answer</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-tertiary">
          <span className="font-mono">{a.key}</span>
          <span>·</span>
          <span>{a.categoryName ?? "Uncategorized"}</span>
          <span>·</span>
          <span className="uppercase">{a.locale}</span>
          <span>·</span>
          <span>{relativeTime(a.updated_at)}</span>
        </div>
      </div>
      <ValidityChip from={a.valid_from} to={a.valid_to} />
      <AiChip on={a.available_to_ai} />
      <ScopeBadge scope={a.source_type} />
      <StatusPill status={a.status} />
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

function Filter<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}
      className="h-8 rounded-md border border-border-strong bg-surface-sunken px-2 text-[12px] text-ink-secondary focus-visible:border-brand-goldDeep focus-visible:outline-none">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
