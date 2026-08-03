"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ShieldCheck, ShieldOff, Lock, FileLock2, User } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useConsent, useRevokeConsent } from "@/data/consents";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState } from "@/components/content/states";
import { ConsentPill } from "@/components/reception/rec-pills";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

export default function ConsentRecord() {
  const { consentId } = useParams<{ consentId: string }>();
  const { role } = usePermissions();
  const q = useConsent(consentId);
  const revoke = useRevokeConsent();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const mayRevoke = role === "platform_admin" || role === "hotel_admin" || role === "reception";

  if (q.isError) return <div className="mx-auto max-w-[760px] p-6"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  if (q.isLoading || !q.data) return <div className="mx-auto max-w-[760px] p-6"><SectionLoader rows={5} /></div>;
  const c = q.data;

  const doRevoke = async () => { setErr(null); try { await revoke.mutateAsync(c.id); setConfirmOpen(false); } catch (e) { setErr(humanizeError(e)); } };

  return (
    <div className="mx-auto max-w-[760px] p-6">
      <PageHeader
        crumbs={[{ label: "Consent", href: "/consent" }, { label: `${c.consentType} v${c.consentVersion}` }]}
        title={<span className="flex items-center gap-3">Signed consent <ConsentPill hasConsent={c.status === "granted"} revoked={c.status === "revoked"} /></span>}
        subtitle={<span className="flex items-center gap-2"><Lock className="h-3.5 w-3.5" /> Immutable signed record — never editable.</span>}
        backHref="/consent"
        actions={mayRevoke && c.status === "granted" && <Button variant="ghost" onClick={() => setConfirmOpen(true)}><ShieldOff className="h-4 w-4" /> Revoke</Button>}
      />

      {err && <p className="mb-4 text-[12px] text-danger">{err}</p>}

      {c.status === "revoked" && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-border-subtle bg-surface-base px-3 py-2.5 text-[13px] text-ink-secondary">
          <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" /> This consent was revoked on {fmt(c.revokedAt)}. The original signed record below is preserved unchanged.
        </div>
      )}

      <Card className="p-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
          <Item label="Type"><span className="text-ink-primary">{c.consentType}</span></Item>
          <Item label="Template version"><span className="font-mono text-ink-primary">v{c.consentVersion}</span></Item>
          <Item label="Language"><span className="uppercase text-ink-primary">{c.locale}</span></Item>
          <Item label="Signed name"><span className="text-ink-primary">{c.signedName}</span></Item>
          <Item label="Signed at"><span className="text-ink-primary">{fmt(c.signedAt)}</span></Item>
          <Item label="Recorded by"><span className="flex items-center gap-1.5 text-ink-primary"><User className="h-3.5 w-3.5 text-ink-tertiary" /> Staff</span></Item>
        </dl>

        <div className="mt-5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary"><Lock className="h-3.5 w-3.5" /> Exact signed text (snapshot)</div>
          <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-border-strong bg-surface-sunken px-3 py-2.5 text-[13px] leading-relaxed text-ink-secondary">{c.textSnapshot}</div>
        </div>

        <div className="mt-4 flex items-center gap-4 text-[12px] text-ink-tertiary">
          <span className="flex items-center gap-1.5"><FileLock2 className="h-3.5 w-3.5" /> Signature file: {c.hasSignatureAsset ? "stored (private)" : "not captured"}</span>
          <span className="flex items-center gap-1.5"><FileLock2 className="h-3.5 w-3.5" /> Document: {c.hasDocumentAsset ? "stored (private)" : "none"}</span>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-[12px]">
          <Link href={`/guests/${c.guestId}`} className="text-ink-tertiary hover:text-ink-secondary">Open guest →</Link>
          {c.stayId && <Link href={`/stays/${c.stayId}`} className="text-ink-tertiary hover:text-ink-secondary">Open stay →</Link>}
        </div>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Revoke this consent?</DialogTitle><DialogDescription>Revocation is recorded additively — the original signed snapshot is preserved forever. This does not delete or edit the signed record.</DialogDescription></DialogHeader>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button><Button variant="primary" onClick={doRevoke} loading={revoke.isPending}><ShieldOff className="h-4 w-4" /> Revoke consent</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-[11px] uppercase tracking-wide text-ink-tertiary">{label}</dt><dd className="mt-0.5">{children}</dd></div>;
}
