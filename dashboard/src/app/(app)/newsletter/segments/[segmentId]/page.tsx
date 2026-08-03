"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Plus, X, Save, Trash2 } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useSegment, useUpdateSegment, useDeleteSegment, useSegmentMembers, useSegmentMembership, validateRules, ruleSummary, RULE_FIELDS } from "@/data/segments";
import { useSubscribers } from "@/data/subscribers";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState } from "@/components/content/states";
import { SegmentTypeBadge } from "@/components/newsletter/nl-pills";
import { AudiencePreview } from "@/components/newsletter/audience-preview";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import type { SegmentRuleCondition, SegmentRules } from "@/data/newsletter-types";

export default function SegmentDetail() {
  const { segmentId } = useParams<{ segmentId: string }>();
  const { currentHotel } = useHotel();
  const router = useRouter();
  const q = useSegment(segmentId);
  const update = useUpdateSegment(currentHotel?.id);
  const del = useDeleteSegment(currentHotel?.id);
  const [rules, setRules] = React.useState<SegmentRules>({ match: "all", conditions: [] });
  const [dirty, setDirty] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (q.data?.rules) { setRules(q.data.rules); setDirty(false); } }, [q.data?.id]);

  if (q.isError) return <div className="mx-auto max-w-[1000px] p-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  if (q.isLoading || !q.data) return <div className="mx-auto max-w-[1000px] p-6"><SectionLoader rows={5} /></div>;
  const seg = q.data;

  const run = async (p: Promise<unknown>) => { setErr(null); try { await p; } catch (e) { setErr(humanizeError(e)); } };
  const saveRules = () => { const v = validateRules(rules); if (v) { setErr(v); return; } run(update.mutateAsync({ id: seg.id, patch: { rules } }).then(() => setDirty(false))); };

  const setCond = (i: number, patch: Partial<SegmentRuleCondition>) => { setRules((r) => ({ ...r, conditions: r.conditions.map((c, j) => j === i ? { ...c, ...patch } : c) })); setDirty(true); };
  const addCond = () => { setRules((r) => ({ ...r, conditions: [...r.conditions, { field: "locale", op: "eq", value: "" }] })); setDirty(true); };
  const rmCond = (i: number) => { setRules((r) => ({ ...r, conditions: r.conditions.filter((_, j) => j !== i) })); setDirty(true); };

  return (
    <div className="mx-auto max-w-[1000px] p-6">
      <PageHeader
        crumbs={[{ label: "Newsletter", href: "/newsletter" }, { label: "Segments", href: "/newsletter/segments" }, { label: seg.name }]}
        title={<span className="flex items-center gap-3">{seg.name} <SegmentTypeBadge type={seg.type} /></span>}
        subtitle={seg.type === "rule" ? ruleSummary(seg.rules) : `Static list · ${seg.key}`}
        backHref="/newsletter/segments"
        actions={<Button variant="ghost" onClick={() => run(del.mutateAsync(seg.id).then(() => router.push("/newsletter/segments")))}><Trash2 className="h-4 w-4" /> Delete</Button>}
      />

      {err && <p className="mb-4 text-[12px] text-danger">{err}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          {seg.type === "rule" ? (
            <Card className="p-5">
              <h2 className="mb-3 text-[13px] font-semibold text-ink-primary">Rules</h2>
              <div className="mb-3 flex items-center gap-2 text-[12px]">
                <span className="text-ink-tertiary">Match</span>
                <select value={rules.match} onChange={(e) => { setRules((r) => ({ ...r, match: e.target.value as "all" | "any" })); setDirty(true); }} className="h-8 rounded-md border border-border-strong bg-surface-sunken px-2 text-[12px] text-ink-primary focus-visible:outline-none">
                  <option value="all">all conditions</option><option value="any">any condition</option>
                </select>
              </div>
              <div className="space-y-2">
                {rules.conditions.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select value={c.field} onChange={(e) => setCond(i, { field: e.target.value as any })} className="h-8 rounded-md border border-border-strong bg-surface-sunken px-2 text-[12px] text-ink-primary focus-visible:outline-none">{RULE_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}</select>
                    <select value={c.op} onChange={(e) => setCond(i, { op: e.target.value as any })} className="h-8 rounded-md border border-border-strong bg-surface-sunken px-2 text-[12px] text-ink-primary focus-visible:outline-none"><option value="eq">=</option><option value="in">in</option></select>
                    <Input value={Array.isArray(c.value) ? c.value.join(",") : c.value} onChange={(e) => setCond(i, { value: c.op === "in" ? e.target.value.split(",").map((x) => x.trim()) : e.target.value })} placeholder={c.op === "in" ? "en,hr" : "en"} className="h-8 flex-1" />
                    <button onClick={() => rmCond(i)} className="rounded p-1 text-ink-tertiary hover:text-danger"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                <button onClick={addCond} className="flex items-center gap-1 text-[12px] text-ink-tertiary hover:text-brand-cream"><Plus className="h-3.5 w-3.5" /> Add condition</button>
              </div>
              <p className="mt-3 text-[11px] text-ink-tertiary">Only validated fields ({RULE_FIELDS.join(", ")}) — no arbitrary SQL. Consent is always enforced at send.</p>
              <div className="mt-3 flex justify-end"><Button variant="secondary" size="sm" onClick={saveRules} loading={update.isPending} disabled={!dirty}><Save className="h-4 w-4" /> Save rules</Button></div>
            </Card>
          ) : (
            <StaticMembers segmentId={seg.id} hotelId={currentHotel?.id} />
          )}
        </div>

        <div>
          <Card className="p-5">
            <h2 className="mb-3 text-[13px] font-semibold text-ink-primary">Audience preview</h2>
            <AudiencePreview segmentId={seg.id} />
          </Card>
        </div>
      </div>
    </div>
  );
}

function StaticMembers({ segmentId, hotelId }: { segmentId: string; hotelId?: string }) {
  const membersQ = useSegmentMembers(segmentId);
  const subsQ = useSubscribers(hotelId);
  const { add, remove } = useSegmentMembership(segmentId);
  const [err, setErr] = React.useState<string | null>(null);
  const memberSet = new Set(membersQ.data ?? []);
  const subs = subsQ.data ?? [];
  const run = async (p: Promise<unknown>) => { setErr(null); try { await p; } catch (e) { setErr(humanizeError(e)); } };

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-[13px] font-semibold text-ink-primary">Members</h2>
      <p className="mb-3 text-[12px] text-ink-tertiary">Manual list. Consent is still enforced at send time — a member without consent won’t be sent to.</p>
      {err && <p className="mb-2 text-[12px] text-danger">{err}</p>}
      {subsQ.isLoading ? <SectionLoader rows={3} /> : subs.length === 0 ? <p className="text-[13px] text-ink-tertiary">No subscribers to add.</p> : (
        <div className="max-h-[360px] space-y-1 overflow-y-auto">
          {subs.map((s) => {
            const on = memberSet.has(s.id);
            return (
              <div key={s.id} className="flex items-center gap-2 rounded-md border border-border-subtle px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-secondary">{s.email}</span>
                <Button variant={on ? "ghost" : "secondary"} size="sm" onClick={() => run(on ? remove.mutateAsync(s.id) : add.mutateAsync(s.id))}>{on ? <><X className="h-3.5 w-3.5" /> Remove</> : <><Plus className="h-3.5 w-3.5" /> Add</>}</Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
