"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PenLine, ShieldCheck } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useStay } from "@/data/stays";
import { useConsentTemplates, signableTemplates, useSignConsent } from "@/data/consents";
import { uploadPrivate } from "@/data/storage";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { SignaturePad, SignatureClearButton, type SignaturePadHandle } from "@/components/reception/signature-pad";
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
  const [hasInk, setHasInk] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const padRef = React.useRef<SignaturePadHandle>(null);

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
      // Optional signature: private-upload a compact PNG, link it to the consent.
      let signatureAssetId: string | null = null;
      const blob = padRef.current && !padRef.current.isEmpty() ? await padRef.current.toBlob() : null;
      if (blob) {
        setUploading(true);
        const file = new File([blob], `signature-${Date.now()}.png`, { type: "image/png" });
        const up = await uploadPrivate({ file, assetType: "consent_signature", hotelId: stay.hotelId, displayName: `Signature — ${signedName.trim()}` });
        signatureAssetId = up.assetId;
        setUploading(false);
      }
      const c: any = await sign.mutateAsync({ templateId: template.id, guestId: stay.guestId, stayId: stay.id, signedName: signedName.trim(), device: { source: "dashboard", staff_confirmed: true, signed_with_signature: !!signatureAssetId }, signatureAssetId });
      router.push(`/consent/${c.id}`);
    } catch (e) { setUploading(false); setError(humanizeError(e)); }
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

            {/* Signature pad — optional; uploaded privately and linked to the consent */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Signature <span className="normal-case text-ink-tertiary/70">(optional)</span></label>
                {hasInk && <SignatureClearButton onClick={() => { padRef.current?.clear(); setHasInk(false); }} />}
              </div>
              <SignaturePad ref={padRef} onChange={setHasInk} disabled={sign.isPending || uploading} />
              <p className="mt-1 text-[11px] text-ink-tertiary">Sign above with a mouse or touch. The image is stored privately (consent-files) and linked to this record — never public, never overwritten.</p>
            </div>

            <label className="flex items-start gap-2.5 rounded-md border border-border-subtle bg-surface-base p-3">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[color:var(--brand-cream)]" />
              <span className="text-[13px] text-ink-secondary">I confirm the guest reviewed and agreed to the text above, and I am recording this consent on their behalf as staff.</span>
            </label>

            {error && <p className="text-[12px] text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => router.push(`/stays/${stay.id}`)}>Cancel</Button>
              <Button variant="primary" onClick={submit} loading={sign.isPending || uploading} disabled={!confirmed || !signedName.trim()}><PenLine className="h-4 w-4" /> {uploading ? "Saving signature…" : "Record consent"}</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
