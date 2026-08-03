"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Snowflake, CalendarClock, XCircle, Copy, Save, Activity, Radio, FlaskConical } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useCampaign, useUpdateCampaign, useScheduleCampaign, useCancelCampaign, useDuplicateCampaign } from "@/data/campaigns";
import { useCampaignEvents, useWebhookEvents } from "@/data/newsletter-events";
import { useTemplates } from "@/data/newsletter-templates";
import { useSegments } from "@/data/segments";
import { humanizeError } from "@/data/errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState } from "@/components/content/states";
import { CampaignStatusPill } from "@/components/newsletter/nl-pills";
import { EmailPreview } from "@/components/newsletter/email-preview";
import { AudiencePreview } from "@/components/newsletter/audience-preview";
import { Field } from "@/components/content/fields";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { relativeTime } from "@/lib/utils";

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

export default function CampaignDetail() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const router = useRouter();
  const q = useCampaign(campaignId);
  const eventsQ = useCampaignEvents(campaignId);
  const webhooksQ = useWebhookEvents(campaignId);
  const templatesQ = useTemplates(currentHotel?.id);
  const segmentsQ = useSegments(currentHotel?.id);
  const update = useUpdateCampaign(currentHotel?.id);
  const schedule = useScheduleCampaign(currentHotel?.id);
  const cancel = useCancelCampaign(currentHotel?.id);
  const duplicate = useDuplicateCampaign(currentHotel?.id);
  const [err, setErr] = React.useState<string | null>(null);
  const [when, setWhen] = React.useState("");
  const [devMsg, setDevMsg] = React.useState<string | null>(null);
  const [name, setName] = React.useState(""); const [tpl, setTpl] = React.useState(""); const [seg, setSeg] = React.useState("");
  React.useEffect(() => { if (q.data) { setName(q.data.name); setTpl(q.data.templateId ?? ""); setSeg(q.data.segmentId ?? ""); } }, [q.data]);

  const canManage = role === "platform_admin" || role === "hotel_admin" || role === "marketing";
  const run = async (p: Promise<unknown>) => { setErr(null); try { await p; } catch (e) { setErr(humanizeError(e)); } };

  if (q.isError) return <div className="mx-auto max-w-[1100px] p-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  if (q.isLoading || !q.data) return <div className="mx-auto max-w-[1100px] p-6"><SectionLoader rows={6} /></div>;
  const c = q.data;
  const isDraft = c.status === "draft" || c.status === "preview";
  const frozen = c.status === "scheduled" || c.status === "sending" || c.status === "sent" || c.status === "cancelled";
  const published = (templatesQ.data ?? []).filter((t) => t.status === "published");

  const simulateEvent = async () => {
    setDevMsg(null); setErr(null);
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const token = data.session?.access_token; if (!token) return;
      const res = await fetch("/api/newsletter/webhook-dev", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ campaignId: c.id, providerEventId: `dev-${c.id}-${Date.now()}`, eventType: "delivered" }) });
      const j = await res.json();
      setDevMsg(res.ok ? (j.ingested ? "Synthetic delivered event ingested." : "Duplicate (idempotent) — not re-ingested.") : (j.error ?? "Failed"));
      eventsQ.refetch(); webhooksQ.refetch();
    } catch (e) { setErr(humanizeError(e)); }
  };

  return (
    <div className="mx-auto max-w-[1100px] p-6">
      <PageHeader
        crumbs={[{ label: "Newsletter", href: "/newsletter" }, { label: "Campaigns", href: "/newsletter/campaigns" }, { label: c.name }]}
        title={<span className="flex items-center gap-3">{c.name} <CampaignStatusPill status={c.status} /></span>}
        subtitle={c.status === "scheduled" && c.scheduledAt ? `Scheduled for ${new Date(c.scheduledAt).toLocaleString()}` : c.status === "sent" && c.sentAt ? `Sent ${new Date(c.sentAt).toLocaleString()}` : undefined}
        backHref="/newsletter/campaigns"
        actions={canManage && <>
          <Button variant="ghost" onClick={() => run(duplicate.mutateAsync(c).then((id: any) => router.push(`/newsletter/campaigns/${id}`)))}><Copy className="h-4 w-4" /> Duplicate</Button>
          {c.status === "scheduled" && <Button variant="ghost" onClick={() => run(cancel.mutateAsync(c.id))}><XCircle className="h-4 w-4" /> Cancel</Button>}
        </>}
      />

      {err && <p className="mb-4 rounded-md border border-danger/30 bg-danger-soft/40 px-3 py-2 text-[13px] text-danger">{err}</p>}
      {frozen && <div className="mb-4 flex items-center gap-2 rounded-md border border-info/30 bg-info-soft/20 px-3 py-2 text-[13px] text-info"><Snowflake className="h-4 w-4" /> Scheduled campaigns use a frozen snapshot — template & segment edits after scheduling don’t change this campaign.</div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left — content + events */}
        <div className="space-y-4">
          {frozen ? (
            <Card className="p-5"><EmailPreview subject={c.subjectSnapshot ?? ""} previewText={c.previewTextSnapshot ?? null} content={c.contentSnapshot} hotelName={currentHotel?.name ?? "Your Hotel"} /></Card>
          ) : canManage ? (
            <Card className="p-5">
              <h2 className="mb-3 text-[13px] font-semibold text-ink-primary">Draft setup</h2>
              <div className="space-y-3">
                <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Template"><select value={tpl} onChange={(e) => setTpl(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:outline-none"><option value="">Choose…</option>{published.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
                  <Field label="Segment"><select value={seg} onChange={(e) => setSeg(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:outline-none"><option value="">Choose…</option>{(segmentsQ.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
                </div>
                <div className="flex justify-end"><Button variant="secondary" size="sm" onClick={() => run(update.mutateAsync({ id: c.id, patch: { name, templateId: tpl || null, segmentId: seg || null } }))} loading={update.isPending}><Save className="h-4 w-4" /> Save draft</Button></div>
              </div>
            </Card>
          ) : null}

          {/* Delivery events */}
          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-primary"><Activity className="h-4 w-4" /> Delivery events</span>
              {canManage && <button onClick={simulateEvent} className="inline-flex items-center gap-1 text-[11px] text-ink-tertiary hover:text-ink-secondary" title="Dev-only synthetic ingestion — no email sent"><FlaskConical className="h-3.5 w-3.5" /> Simulate (dev)</button>}
            </div>
            {devMsg && <p className="px-4 pt-2 text-[11px] text-ink-tertiary">{devMsg}</p>}
            {eventsQ.isLoading ? <div className="p-4"><SectionLoader rows={2} /></div> : (eventsQ.data ?? []).length === 0 ? <p className="px-4 py-6 text-center text-[13px] text-ink-tertiary">No delivery events yet.</p> : (
              <ol className="max-h-64 divide-y divide-border-subtle overflow-y-auto">
                {eventsQ.data!.map((e) => <li key={e.id} className="flex items-center gap-3 px-4 py-2"><span className="flex-1 text-[13px] capitalize text-ink-secondary">{e.eventType}</span><span className="text-[11px] text-ink-tertiary">{relativeTime(e.occurredAt)}</span></li>)}
              </ol>
            )}
          </Card>

          {/* Webhook (provider) events — redacted */}
          <Card className="p-0">
            <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3"><Radio className="h-4 w-4 text-ink-tertiary" /><span className="text-[13px] font-semibold text-ink-primary">Provider events (webhook)</span></div>
            {(webhooksQ.data ?? []).length === 0 ? <p className="px-4 py-5 text-center text-[13px] text-ink-tertiary">No provider events. Payloads are redacted — never raw JSON.</p> : (
              <div className="max-h-56 divide-y divide-border-subtle overflow-y-auto">
                {webhooksQ.data!.map((w) => <div key={w.id} className="flex items-center gap-3 px-4 py-2 text-[12px]"><span className="font-mono text-ink-tertiary">{w.provider}</span><span className="min-w-0 flex-1 truncate text-ink-secondary">{w.summary}</span><span className="text-[11px] text-ink-tertiary">{relativeTime(w.createdAt)}</span></div>)}
              </div>
            )}
          </Card>
        </div>

        {/* Right — targeting + results + schedule */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Results</div>
            {c.status === "sent" ? (
              <dl className="space-y-2 text-[13px]">
                <Row label="Recipients">{c.totals.recipients}</Row>
                <Row label="Delivered">{c.totals.delivered} <span className="text-ink-tertiary">({pct(c.totals.delivered, c.totals.recipients)})</span></Row>
                <Row label="Opened">{c.totals.opened} <span className="text-ink-tertiary">({pct(c.totals.opened, c.totals.delivered)})</span></Row>
                <Row label="Clicked">{c.totals.clicked} <span className="text-ink-tertiary">({pct(c.totals.clicked, c.totals.delivered)})</span></Row>
                <Row label="Bounced">{c.totals.bounced}</Row>
                <Row label="Unsubscribed">{c.totals.unsubscribed}</Row>
              </dl>
            ) : c.status === "scheduled" ? (
              <p className="text-[13px] text-ink-tertiary">Frozen for {c.totals.recipients} recipient{c.totals.recipients === 1 ? "" : "s"}. Results appear after delivery.</p>
            ) : (
              <div><p className="mb-2 text-[13px] text-ink-tertiary">Estimated audience:</p>{c.segmentId ? <AudiencePreview segmentId={c.segmentId} /> : <p className="text-[12px] text-ink-tertiary">No segment selected.</p>}</div>
            )}
            {c.brevoCampaignId && <p className="mt-3 font-mono text-[11px] text-ink-tertiary">Brevo id: {c.brevoCampaignId}</p>}
          </Card>

          {isDraft && canManage && (
            <Card className="p-5">
              <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary"><CalendarClock className="h-3.5 w-3.5" /> Schedule</div>
              <p className="mb-2 text-[11px] text-ink-tertiary">Freezes a snapshot. No email sent in this environment.</p>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mb-2" />
              <Button variant="primary" size="sm" className="w-full" disabled={!when || !c.templateId || !c.segmentId} loading={schedule.isPending} onClick={() => run(schedule.mutateAsync({ id: c.id, scheduledAt: new Date(when).toISOString() }))}><CalendarClock className="h-4 w-4" /> Schedule campaign</Button>
              {(!c.templateId || !c.segmentId) && <p className="mt-1 text-[11px] text-warning">Set a published template and a segment first.</p>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><dt className="text-ink-tertiary">{label}</dt><dd className="text-ink-primary">{children}</dd></div>;
}
