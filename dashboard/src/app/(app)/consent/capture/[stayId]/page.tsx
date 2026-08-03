"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PenLine, ShieldCheck, Info } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useStay } from "@/data/stays";
import { useConsentTemplates, signableTemplates, useSignConsent } from "@/data/consents";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ConsentCapture() {
  const { stayId } = useParams<{ stayId: string }>();
  const router = useRouter();
  const { currentHotel } = useHotel();
  const stayQ = useStay(stayId);
  const templatesQ = useConsentTemplates(currentHotel?.id);
  const sign = useSignConsent();

  const [templateId, setTemplateId] = React.useState("");
  const [signedName, setSignedName] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [nameTouched, setNameTouched] = React.useState(false);

  const signable = signableTemplates(templatesQ.data ?? []);
  const template = signable.find((t) => t.id === templateId) ?? signable[0];
  React.useEffect(() => { if (!templateId && signable[0]) setTemplateId(signable[0].id); }, [signable, templateId]);
  React.useEffect(() => { if (!nameTouched && stayQ.data?.guestName) setSignedName(stayQ.data.guestName); }, [stayQ.data?.guestName, nameTouched]);

  if (stayQ.isError) return <div className="mx-auto max-w-[760px] p-6"><ErrorState error={stayQ.error} onRetry={() => stayQ.refetch()} /></div>;
  if (stayQ.isLoading || !stayQ.data) return <div className="mx-auto max-w-[760px] p-6"><SectionLoader rows={5} /></div>;
  const stay = stayQ.data;

  const submit = async () => {
    setError(null);
    if (!template) { setError("Choose a published template."); return; }
    if (!stay.guestId) { setError("This stay has no linked guest — link a guest first."); return; }
    if (!signedName.trim()) { setError("Enter the signer's name."); return; }
    if (!confirmed) { setError("Confirm the guest agrees to the text above."); return; }
    try {
      const c: any = await sign.mutateAsync({ templateId: template.id, guestId: stay.guestId, stayId: stay.id, signedName: signedName.trim(), device: { source: "dashboard", staff_confirmed: true } });
      router.push(`/consent/${c.id}`);
    } catch (e) { setError(humanizeError(e)); }
  };

  return (
    <div className="mx-auto max-w-[760px] p-6">
      <PageHeader
        crumbs={[{ label: "Consent", href: "/consent" }, { label: "Capture" }]}
        title="Capture consent"
        subtitle={`For ${stay.guestName ?? "the guest"}${stay.roomNumber ? ` · Room ${stay.roomNumber}` : ""}`}
        backHref={`/stays/${stay.id}`}
      />

      {signable.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No signable templates" hint="Publish a consent template first." action={<Link href="/consent/templates" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-cream px-3 text-[13px] font-semibold text-brand-navy">Manage templates</Link>} />
      ) : (
        <Card className="p-5">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Template</label>
                <select value={template?.id ?? ""} onChange={(e) => setTemplateId(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">
                  {Array.from(new Map(signable.map((t) => [`${t.key}:${t.locale}`, t])).values()).map((t) => <option key={t.id} value={t.id}>{t.title} ({t.locale} v{t.version})</option>)}
                </select>
              </div>
              <div className="flex items-end"><span className="text-[12px] text-ink-tertiary">Signing version <span className="font-mono text-ink-secondary">v{template?.version}</span> — the exact text below is what gets stored.</span></div>
            </div>

            {/* Exact approved text */}
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Approved text</label>
              <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border border-border-strong bg-surface-sunken px-3 py-2.5 text-[13px] leading-relaxed text-ink-secondary">{template?.bodyText}</div>
            </div>

            <div className="space-y-1.5"><label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Signed name</label><Input value={signedName} onChange={(e) => { setSignedName(e.target.value); setNameTouched(true); }} placeholder="Guest's full name" /></div>

            <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info-soft/30 px-3 py-2 text-[12px] text-info"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Signature image capture is deferred in this environment — no signature file is created or faked. The signed name, exact text and staff member are recorded.</div>

            <label className="flex items-start gap-2.5 rounded-md border border-border-subtle bg-surface-base p-3">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[color:var(--brand-cream)]" />
              <span className="text-[13px] text-ink-secondary">I confirm the guest reviewed and agreed to the text above, and I am recording this consent on their behalf as staff.</span>
            </label>

            {error && <p className="text-[12px] text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => router.push(`/stays/${stay.id}`)}>Cancel</Button>
              <Button variant="primary" onClick={submit} loading={sign.isPending} disabled={!confirmed || !signedName.trim()}><PenLine className="h-4 w-4" /> Record consent</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
