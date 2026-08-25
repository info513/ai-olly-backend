"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Mail, Globe, Tag, ShieldCheck, UserMinus, Ban, Save, Activity, RefreshCw } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useSubscriber, useSubscriberActions } from "@/data/subscribers";
import { useSubscriberEvents } from "@/data/newsletter-events";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState } from "@/components/content/states";
import { SubscriberStatusPill, ConsentPill } from "@/components/newsletter/nl-pills";
import { TextField } from "@/components/content/fields";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/utils";
import type { Subscriber } from "@/data/newsletter-types";

export default function SubscriberDetail() {
  const { subscriberId } = useParams<{ subscriberId: string }>();
  const { currentHotel } = useHotel();
  const { role } = usePermissions();
  const q = useSubscriber(subscriberId, currentHotel?.id);
  const actions = useSubscriberActions(currentHotel?.id);
  const eventsQ = useSubscriberEvents(subscriberId);
  const [form, setForm] = React.useState<Partial<Subscriber>>({});
  const [dirty, setDirty] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (q.data) { setForm(q.data); setDirty(false); } }, [q.data]);

  const canManage = role === "platform_admin" || role === "hotel_admin" || role === "marketing";
  const canSeeConsent = role === "platform_admin" || role === "hotel_admin" || role === "reception";
  const run = async (p: Promise<unknown>) => { setErr(null); try { await p; } catch (e) { setErr(humanizeError(e)); } };

  if (q.isError) return <div className="mx-auto max-w-[1000px] p-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  if (q.isLoading || !q.data) return <div className="mx-auto max-w-[1000px] p-6"><SectionLoader rows={5} /></div>;
  const s = q.data;
  const canSubscribe = !!s.consentId && s.consentState === "active";

  const saveProfile = () => run(actions.updateProfile(s.id, { firstName: form.firstName ?? null, lastName: form.lastName ?? null, locale: form.locale ?? null }).then(() => setDirty(false)));

  return (
    <div className="mx-auto max-w-[1000px] p-6">
      <PageHeader
        crumbs={[{ label: "Marketing", href: "/newsletter" }, { label: "Contacts", href: "/newsletter/subscribers" }, { label: s.email }]}
        title={<span className="flex items-center gap-3">{[s.firstName, s.lastName].filter(Boolean).join(" ") || s.email} <SubscriberStatusPill status={s.status} /></span>}
        subtitle={<span className="flex items-center gap-2"><ConsentPill state={s.consentState} /></span>}
        backHref="/newsletter/subscribers"
      />

      {err && <p className="mb-4 text-[12px] text-danger">{err}</p>}

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Left — identity + consent + actions */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Identity</div>
            <dl className="space-y-2.5 text-[13px]">
              <Info icon={Mail} label="Email" value={s.email} />
              <Info icon={Globe} label="Locale" value={s.locale?.toUpperCase() ?? null} />
              <Info icon={Tag} label="Source" value={s.source} />
              {s.tags.length > 0 && <Info icon={Tag} label="Tags" value={s.tags.join(", ")} />}
              <Info icon={RefreshCw} label="Brevo sync" value={s.brevoContactId ? "Synced" : "Not synced"} />
            </dl>
          </Card>

          <Card className="p-5">
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Consent</div>
            <ConsentPill state={s.consentState} />
            <p className="mt-2 text-[12px] text-ink-tertiary">{s.consentState === "active" ? "Valid marketing consent on file. Sends are allowed." : s.consentState === "revoked" ? "Consent was revoked — excluded from sends." : "No marketing consent linked — excluded from sends."}</p>
            {s.consentId && canSeeConsent && <Link href={`/consent/${s.consentId}`} className="mt-2 block text-[12px] text-ink-tertiary hover:text-ink-secondary">View consent record →</Link>}
          </Card>

          {canManage && (
            <Card className="p-5">
              <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Actions</div>
              <div className="space-y-2">
                {s.status !== "subscribed" && (
                  <Button variant="secondary" size="sm" className="w-full justify-start" disabled={!canSubscribe} loading={actions.isPending} onClick={() => run(actions.subscribe(s.id, s.consentId!))}><ShieldCheck className="h-4 w-4" /> Subscribe {canSubscribe ? "" : "(needs consent)"}</Button>
                )}
                {s.status === "subscribed" && <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => run(actions.unsubscribe(s.id))}><UserMinus className="h-4 w-4" /> Unsubscribe</Button>}
                {s.status !== "suppressed" && <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => run(actions.suppress(s.id))}><Ban className="h-4 w-4" /> Suppress</Button>}
              </div>
              {!canSubscribe && s.status !== "subscribed" && <p className="mt-2 text-[11px] text-ink-tertiary">Capture marketing consent before subscribing.</p>}
              {s.guestId && canSeeConsent && <Link href={`/guests/${s.guestId}`} className="mt-3 block text-[12px] text-ink-tertiary hover:text-ink-secondary">Open related guest →</Link>}
            </Card>
          )}
        </div>

        {/* Right — profile + activity */}
        <div className="space-y-4">
          {canManage && (
            <Card className="p-5">
              <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">Profile</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="First name" value={form.firstName ?? ""} onChange={(v) => { setForm((f) => ({ ...f, firstName: v })); setDirty(true); }} />
                <TextField label="Last name" value={form.lastName ?? ""} onChange={(v) => { setForm((f) => ({ ...f, lastName: v })); setDirty(true); }} />
              </div>
              <div className="mt-3 flex justify-end"><Button variant="secondary" size="sm" onClick={saveProfile} loading={actions.isPending} disabled={!dirty}><Save className="h-4 w-4" /> Save</Button></div>
            </Card>
          )}

          <Card className="p-0">
            <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3"><Activity className="h-4 w-4 text-ink-tertiary" /><span className="text-[13px] font-semibold text-ink-primary">Delivery activity</span></div>
            {eventsQ.isLoading ? <div className="p-4"><SectionLoader rows={2} /></div> : (eventsQ.data ?? []).length === 0 ? <p className="px-4 py-6 text-center text-[13px] text-ink-tertiary">No delivery events yet.</p> : (
              <ol className="divide-y divide-border-subtle">
                {eventsQ.data!.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-2 rounded-full" />
                    <span className="flex-1 text-[13px] capitalize text-ink-secondary">{e.eventType}</span>
                    {e.campaignId && <Link href={`/newsletter/campaigns/${e.campaignId}`} className="text-[11px] text-ink-tertiary hover:text-ink-secondary">campaign →</Link>}
                    <span className="text-[11px] text-ink-tertiary">{relativeTime(e.occurredAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string | null }) {
  return <div className="flex items-center gap-2.5"><Icon className="h-4 w-4 shrink-0 text-ink-tertiary" /><span className="w-16 shrink-0 text-ink-tertiary">{label}</span><span className="min-w-0 flex-1 truncate text-ink-primary">{value ?? <span className="italic text-ink-tertiary">—</span>}</span></div>;
}
