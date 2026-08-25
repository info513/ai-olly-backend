"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Save, CalendarClock, Snowflake } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useTemplates } from "@/data/newsletter-templates";
import { useSegments } from "@/data/segments";
import { useCreateCampaign, useScheduleCampaign } from "@/data/campaigns";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { PermissionDenied } from "@/components/content/states";
import { Field } from "@/components/content/fields";
import { AudiencePreview } from "@/components/newsletter/audience-preview";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function NewCampaign() {
  const router = useRouter();
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const templatesQ = useTemplates(currentHotel?.id);
  const segmentsQ = useSegments(currentHotel?.id);
  const create = useCreateCampaign(currentHotel?.id);
  const schedule = useScheduleCampaign(currentHotel?.id);

  const [name, setName] = React.useState("");
  const [templateId, setTemplateId] = React.useState("");
  const [segmentId, setSegmentId] = React.useState("");
  const [when, setWhen] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const canManage = role === "platform_admin" || role === "hotel_admin" || role === "marketing";
  const published = (templatesQ.data ?? []).filter((t) => t.status === "published");
  const template = published.find((t) => t.id === templateId);

  const saveDraft = async () => {
    setError(null); if (!name.trim()) { setError("Enter a campaign name."); return; }
    setBusy(true);
    try { const id = await create.mutateAsync({ name: name.trim(), templateId: templateId || null, segmentId: segmentId || null }); router.push(`/newsletter/campaigns/${id}`); }
    catch (e) { setError(humanizeError(e)); setBusy(false); }
  };
  const doSchedule = async () => {
    setError(null);
    if (!name.trim()) { setError("Enter a campaign name."); return; }
    if (!template) { setError("Choose a published template to schedule."); return; }
    if (!segmentId) { setError("Choose a segment."); return; }
    if (!when) { setError("Pick a schedule time."); return; }
    setBusy(true);
    try {
      const id = await create.mutateAsync({ name: name.trim(), templateId, segmentId });
      await schedule.mutateAsync({ id, scheduledAt: new Date(when).toISOString() });
      router.push(`/newsletter/campaigns/${id}`);
    } catch (e) { setError(humanizeError(e)); setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-[820px] p-6">
      <PageHeader crumbs={[{ label: "Marketing", href: "/newsletter" }, { label: "Campaigns", href: "/newsletter/campaigns" }, { label: "New" }]} title="New campaign" subtitle="Pick a published template and a segment, preview the consent-filtered audience, then save a draft or schedule." backHref="/newsletter/campaigns" />

      {!canManage ? <PermissionDenied message="Only hotel admins and marketing can create campaigns." /> : (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="space-y-4">
              <Field label="Campaign name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring newsletter" autoFocus /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Template">
                  <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">
                    <option value="">Choose published template…</option>
                    {published.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.locale})</option>)}
                  </select>
                  {published.length === 0 && <p className="mt-1 text-[11px] text-warning">No published templates — publish one first.</p>}
                </Field>
                <Field label="Segment">
                  <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">
                    <option value="">Choose segment…</option>
                    {(segmentsQ.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              </div>
              {template && <div className="rounded-md border border-border-subtle bg-surface-base px-3 py-2 text-[12px] text-ink-secondary"><span className="text-ink-tertiary">Subject preview:</span> {template.subject}</div>}
            </div>
          </Card>

          {segmentId && (
            <Card className="p-5">
              <h2 className="mb-3 text-[13px] font-semibold text-ink-primary">Audience preview</h2>
              <AudiencePreview segmentId={segmentId} />
            </Card>
          )}

          <Card className="p-5">
            <div className="mb-3 flex items-start gap-2 rounded-md border border-info/30 bg-info-soft/20 px-3 py-2 text-[12px] text-info"><Snowflake className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Scheduling freezes a snapshot of the template + segment. Later edits won’t change a scheduled campaign. No email is sent in this environment.</div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Schedule for"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-56" /></Field>
              <Button variant="primary" onClick={doSchedule} loading={busy} disabled={!template || !segmentId || !when}><CalendarClock className="h-4 w-4" /> Schedule</Button>
              <Button variant="secondary" onClick={saveDraft} loading={busy}><Save className="h-4 w-4" /> Save draft</Button>
            </div>
            {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
          </Card>
        </div>
      )}
    </div>
  );
}
