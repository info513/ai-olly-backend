"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, ConciergeBell, ChevronRight, X } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useServices, useCategories, useCreateService } from "@/data/services";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { StatusPill, SourceBadge, VisibilityChips, CriticalBadge } from "@/components/content/pills";
import { ResolvedServicePanel } from "@/components/content/resolved-service-panel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { relativeTime, cn } from "@/lib/utils";
import type { ContentStatus, HotelService, ServiceSource } from "@/data/types";

const canAuthor = (role: string | null) => role === "platform_admin" || role === "hotel_admin" || role === "editor";
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `service-${Math.floor(Math.random() * 1e5)}`;

export default function ServicesList() {
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const params = useSearchParams();
  const router = useRouter();
  const servicesQ = useServices(currentHotel?.id);
  const categoriesQ = useCategories(currentHotel?.id);

  const [tab, setTab] = React.useState<"list" | "resolved">("list");
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<ContentStatus | "all">((params.get("status") as ContentStatus) ?? "all");
  const [source, setSource] = React.useState<ServiceSource | "all">("all");
  const [critical, setCritical] = React.useState(params.get("critical") === "1");
  const [newOpen, setNewOpen] = React.useState(false);

  const items = React.useMemo(() => {
    let list = servicesQ.data ?? [];
    if (status !== "all") list = list.filter((s) => s.status === status);
    if (source !== "all") list = list.filter((s) => s.source_type === source);
    if (critical) list = list.filter((s) => s.is_critical);
    if (q.trim()) {
      const t = q.toLowerCase();
      list = list.filter((s) => s.title.toLowerCase().includes(t) || s.key.toLowerCase().includes(t) || (s.categoryName ?? "").toLowerCase().includes(t));
    }
    return list;
  }, [servicesQ.data, status, source, critical, q]);

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader
        crumbs={[{ label: "Content", href: "/content" }, { label: "Services" }]}
        title="Services"
        subtitle="Everything the AI and guest app can tell guests about your hotel."
        actions={canAuthor(role) && <Button variant="primary" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> New service</Button>}
      />

      {/* Category chips */}
      {!categoriesQ.isLoading && (categoriesQ.data ?? []).length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {categoriesQ.data!.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-raised px-2.5 py-1 text-[12px] text-ink-secondary">
              {c.name}
              <span className="text-ink-tertiary">· {c.serviceCount ?? 0}</span>
              <Badge tone={c.hotel_id ? "neutral" : "brand"} className="ml-0.5 text-[10px]">{c.hotel_id ? "Hotel" : "Platform"}</Badge>
            </span>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex items-center gap-1 border-b border-border-subtle">
        {(["list", "resolved"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("relative px-3 py-2 text-[13px] font-medium transition-colors", tab === t ? "text-ink-primary" : "text-ink-tertiary hover:text-ink-secondary")}>
            {t === "list" ? "All services" : "Guest view"}
            {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-cream" />}
          </button>
        ))}
      </div>

      {tab === "resolved" ? (
        <ResolvedServicePanel hotelId={currentHotel?.id} />
      ) : (
        <>
          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search services…" className="h-8 w-56 pl-8" />
            </div>
            <Filter value={status} onChange={(v) => setStatus(v as any)} options={[["all", "All statuses"], ["draft", "Draft"], ["preview", "Preview"], ["published", "Live"], ["archived", "Archived"]]} />
            <Filter value={source} onChange={(v) => setSource(v as any)} options={[["all", "All sources"], ["platform", "Platform default"], ["hotel", "Hotel service"], ["override", "Hotel override"]]} />
            <button onClick={() => setCritical((c) => !c)} className={cn("rounded-full border px-3 py-1 text-[12px]", critical ? "border-danger/40 bg-danger-soft/40 text-danger" : "border-border-subtle text-ink-tertiary hover:text-ink-secondary")}>
              Critical only
            </button>
            {(status !== "all" || source !== "all" || critical || q) && (
              <button onClick={() => { setStatus("all"); setSource("all"); setCritical(false); setQ(""); }} className="flex items-center gap-1 text-[12px] text-ink-tertiary hover:text-ink-secondary"><X className="h-3.5 w-3.5" /> Clear</button>
            )}
          </div>

          {servicesQ.isError ? (
            <ErrorState error={servicesQ.error} onRetry={() => servicesQ.refetch()} />
          ) : servicesQ.isLoading ? (
            <SectionLoader rows={6} />
          ) : items.length === 0 ? (
            <EmptyState icon={ConciergeBell} title={(servicesQ.data ?? []).length ? "No services match your filters" : "No services yet"} hint={(servicesQ.data ?? []).length ? "Try clearing the filters." : "Create your first service — check-in times, transfers, breakfast."} action={canAuthor(role) && !(servicesQ.data ?? []).length && <Button variant="primary" onClick={() => setNewOpen(true)}>New service</Button>} />
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="divide-y divide-border-subtle">
                {items.map((s) => <ServiceRow key={s.id} s={s} />)}
              </div>
            </Card>
          )}
        </>
      )}

      <NewServiceDialog open={newOpen} onOpenChange={setNewOpen} hotelId={currentHotel?.id} onCreated={(id) => router.push(`/content/services/${id}`)} categories={(categoriesQ.data ?? [])} slugify={slugify} />
    </div>
  );
}

function ServiceRow({ s }: { s: HotelService }) {
  const validity = s.valid_to ? `until ${new Date(s.valid_to).toLocaleDateString()}` : s.valid_from ? "seasonal" : "permanent";
  return (
    <Link href={`/content/services/${s.id}`} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-overlay/50">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-ink-primary">{s.title}</span>
          {s.is_critical && <CriticalBadge />}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-tertiary">
          <span>{s.categoryName ?? "Uncategorized"}</span>
          <span>·</span>
          <span>{validity}</span>
          <span>·</span>
          <span>{relativeTime(s.updated_at)}</span>
        </div>
      </div>
      <VisibilityChips pwa={s.visible_in_pwa} web={s.visible_in_web} ai={s.available_to_ai} className="hidden md:flex" />
      <SourceBadge source={s.source_type} />
      <StatusPill status={s.status} />
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

function Filter({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-border-strong bg-surface-sunken px-2 text-[12px] text-ink-secondary focus-visible:border-brand-goldDeep focus-visible:outline-none">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function NewServiceDialog({
  open, onOpenChange, hotelId, onCreated, categories, slugify,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; hotelId?: string;
  onCreated: (id: string) => void; categories: { id: string; name: string; hotel_id: string | null }[]; slugify: (s: string) => string;
}) {
  const create = useCreateService(hotelId);
  const [title, setTitle] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setTitle(""); setCategoryId(categories[0]?.id ?? ""); setError(null); } }, [open, categories]);

  const submit = async () => {
    setError(null);
    try {
      const id = await create.mutateAsync({ title: title.trim() || "Untitled service", key: slugify(title), category_id: categoryId, body_content: { version: 1, blocks: [{ type: "paragraph", text: "" }] } } as any);
      onOpenChange(false);
      onCreated(id);
    } catch (e) { setError(humanizeError(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New service</DialogTitle>
          <DialogDescription>Starts as a draft — nothing goes live until you publish.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Airport Transfer" autoFocus />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Category</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.hotel_id ? "" : " (platform)"}</option>)}
            </select>
          </div>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" onClick={submit} loading={create.isPending} disabled={!categoryId}>Create draft</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
