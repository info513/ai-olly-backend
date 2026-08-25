"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users, ChevronRight, Plus } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useSegments, useCreateSegment, ruleSummary } from "@/data/segments";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState, PermissionDenied } from "@/components/content/states";
import { SegmentTypeBadge } from "@/components/newsletter/nl-pills";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { Segment } from "@/data/newsletter-types";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export default function SegmentsList() {
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const router = useRouter();
  const q = useSegments(currentHotel?.id);
  const [newOpen, setNewOpen] = React.useState(false);
  const canManage = role === "platform_admin" || role === "hotel_admin" || role === "marketing";

  return (
    <div className="mx-auto max-w-[1000px] p-6">
      <PageHeader
        crumbs={[{ label: "Marketing", href: "/newsletter" }, { label: "Audiences" }]}
        title="Audiences"
        subtitle="Static lists and rule-based audiences. Active marketing consent is always enforced at send time — no audience can override it."
        actions={canManage && <Button variant="primary" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> New segment</Button>}
        backHref="/newsletter"
      />

      {!canManage ? <PermissionDenied message="Segment management is limited to hotel admins and marketing." /> :
        q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : q.isLoading ? <SectionLoader rows={4} />
        : (q.data ?? []).length === 0 ? <EmptyState icon={Users} title="No segments yet" hint="Create a static list or a rule-based audience." action={<Button variant="primary" onClick={() => setNewOpen(true)}>New segment</Button>} />
        : <Card className="overflow-hidden p-0"><div className="divide-y divide-border-subtle">{q.data!.map((s) => <Row key={s.id} s={s} />)}</div></Card>}

      <NewSegmentDialog open={newOpen} onOpenChange={setNewOpen} hotelId={currentHotel?.id} slug={slug} onCreated={(id) => router.push(`/newsletter/segments/${id}`)} />
    </div>
  );
}

function Row({ s }: { s: Segment }) {
  return (
    <Link href={`/newsletter/segments/${s.id}`} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-overlay/50">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="truncate font-medium text-ink-primary">{s.name}</span>{!s.active && <span className="rounded bg-surface-overlay px-1.5 py-0.5 text-[10px] text-ink-tertiary">inactive</span>}</div>
        <div className="mt-0.5 truncate text-[12px] text-ink-tertiary">{s.type === "static" ? `${s.memberCount ?? 0} members` : ruleSummary(s.rules)}</div>
      </div>
      <SegmentTypeBadge type={s.type} />
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

function NewSegmentDialog({ open, onOpenChange, hotelId, slug, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; hotelId?: string; slug: (s: string) => string; onCreated: (id: string) => void }) {
  const create = useCreateSegment(hotelId);
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<"static" | "rule">("static");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setName(""); setType("static"); setError(null); } }, [open]);

  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError("Enter a name."); return; }
    try { const id = await create.mutateAsync({ key: slug(name) || `segment-${Date.now()}`, name: name.trim(), type }); onOpenChange(false); onCreated(id); }
    catch (e) { setError(humanizeError(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New segment</DialogTitle><DialogDescription>Static lists are managed by hand; rule segments match validated fields.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Name</label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="VIP guests" autoFocus /></div>
          <div className="grid grid-cols-2 gap-2">
            {(["static", "rule"] as const).map((t) => (
              <button key={t} onClick={() => setType(t)} className={`rounded-md border px-3 py-2 text-left text-[13px] ${type === t ? "border-brand-goldDeep/50 bg-surface-base text-ink-primary" : "border-border-subtle text-ink-secondary"}`}>
                <div className="font-medium capitalize">{t}</div><div className="text-[11px] text-ink-tertiary">{t === "static" ? "Manual list" : "Field rules"}</div>
              </button>
            ))}
          </div>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={submit} loading={create.isPending}>Create</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
